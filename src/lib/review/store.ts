import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/store/paths";
import { contentHash } from "@/lib/util/identity";
import { supabaseClient, supabaseConfigured } from "@/lib/store/supabase";
import { publishRulePack } from "@/lib/rules/published";
import { zRulePack } from "@/lib/rules/schema";
import { draftStore } from "./drafts";
import { toItems, type ReviewItem } from "./items";

export { locate, type ReviewItem } from "./items";

/**
 * 人工校對紀錄（docs/BACKEND.md §2）。
 *
 * 「校對紀錄要留（誰、何時），決賽可作為資料品質的證據。」
 * 因此本檔只負責：讀草稿、記錄逐條 approve／修正、在全數通過後鎖版。
 */

const REVIEW_DIR = dataDir("reviews");
const PACK_DIR = join(process.cwd(), "src", "lib", "rules", "packs");

export type ReviewDecision = {
  itemId: string;
  status: "approved" | "corrected" | "rejected";
  /** 修正後的內容（status = corrected 時） */
  correction?: string;
  note?: string;
  reviewer: string;
  decidedAt: string;
  /** 校對當時這一項內容的雜湊；草稿改版後內容沒變的項目據此沿用校對結果 */
  itemHash?: string;
};

export type ReviewRecord = {
  packId: string;
  /** 草稿的 content hash。草稿變動後只沿用內容沒變的項目（見 loadRecord），鎖版紀錄一律失效 */
  draftHash: string;
  decisions: ReviewDecision[];
  lockedAt?: string;
  lockedBy?: string;
};

export type DraftView = {
  packId: string;
  draft: Record<string, unknown>;
  /** docId → 原文。跟草稿一起載入，避免出現「草稿在、語料不在」的半套狀態 */
  corpus: Map<string, string>;
  draftHash: string;
  items: ReviewItem[];
  record: ReviewRecord;
};

export async function listDrafts(): Promise<string[]> {
  return draftStore().list();
}

export async function loadDraft(packId: string): Promise<DraftView | null> {
  const bundle = await draftStore().load(packId);
  if (!bundle) return null;

  const draftHash = contentHash(bundle.draft);
  const items = toItems(bundle.draft, bundle.corpus);
  return {
    packId,
    draft: bundle.draft,
    corpus: bundle.corpus,
    draftHash,
    items,
    record: await loadRecord(packId, draftHash, items),
  };
}

/**
 * 校對紀錄的讀寫。
 *
 * 含校對人姓名或代號 —— 那是承辦人員的個資，不是學生的，但一樣要有管轄。
 * 設定了 Supabase 就存資料庫；否則落到 .data/reviews/。在 serverless 上
 * 後者等於不存在（/tmp 換實例就沒了），而「誰在什麼時候通過了哪一條」
 * 正是資料品質的證據，不能留不住。
 */
async function loadRecord(packId: string, draftHash: string, items: ReviewItem[]): Promise<ReviewRecord> {
  const fresh: ReviewRecord = { packId, draftHash, decisions: [] };

  let stored: ReviewRecord | null = null;
  if (supabaseConfigured()) {
    const db = await supabaseClient();
    const { data } = await db.from("review_records").select("record").eq("pack_id", packId).maybeSingle();
    stored = (data as { record: ReviewRecord } | null)?.record ?? null;
  } else {
    const p = join(REVIEW_DIR, `${packId}.json`);
    if (existsSync(p)) stored = JSON.parse(readFileSync(p, "utf8")) as ReviewRecord;
  }

  if (!stored) return fresh;
  if (stored.draftHash === draftHash) return stored;

  // 草稿改過：內容一字未變的項目沿用原本的校對結果，改到的項目（雜湊不同）與新增的項目要重新校對。
  // 以前是整份作廢 —— 改一個數字就要把三十項從頭再看一遍，校對的人會開始不看就按通過，
  // 那比少校對一項更糟。鎖版紀錄一律不沿用：改過的草稿一定要重新鎖版。
  const current = new Map(items.map((i) => [i.id, i.hash]));
  return {
    packId,
    draftHash,
    decisions: stored.decisions.filter((d) => d.itemHash !== undefined && current.get(d.itemId) === d.itemHash),
  };
}

async function saveRecord(packId: string, record: ReviewRecord): Promise<void> {
  if (supabaseConfigured()) {
    const db = await supabaseClient();
    const { error } = await db
      .from("review_records")
      .upsert({ pack_id: packId, record, updated_at: new Date().toISOString() });
    if (error) throw new Error(`寫入 review_records 失敗：${error.message}`);
    return;
  }
  mkdirSync(REVIEW_DIR, { recursive: true });
  writeFileSync(join(REVIEW_DIR, `${packId}.json`), JSON.stringify(record, null, 2), "utf8");
}

export async function saveDecision(packId: string, decision: ReviewDecision): Promise<ReviewRecord> {
  const view = await loadDraft(packId);
  if (!view) throw new Error(`查無草稿 ${packId}`);
  const item = view.items.find((i) => i.id === decision.itemId);
  if (!item) throw new Error(`草稿 ${packId} 沒有項目 ${decision.itemId}`);
  if (view.record.lockedAt) throw new Error(`草稿 ${packId} 已鎖版，不能再改校對結果`);
  const record = view.record;
  record.decisions = [
    ...record.decisions.filter((d) => d.itemId !== decision.itemId),
    { ...decision, itemHash: item.hash },
  ];
  await saveRecord(packId, record);
  return record;
}

/**
 * 鎖版：全數 approved 後才允許，並寫入 provenance=approved、approvedBy 與 contentHash。
 * 只要有一條被 rejected 或未決，就不得鎖版 —— 半套校對的規則包比沒有更危險。
 */
export async function lockPack(
  packId: string,
  reviewer: string,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const view = await loadDraft(packId);
  if (!view) return { ok: false, reason: `查無草稿 ${packId}` };

  const decided = new Map(view.record.decisions.map((d) => [d.itemId, d]));
  const pending = view.items.filter((i) => {
    const d = decided.get(i.id);
    return !d || d.status === "rejected";
  });
  if (pending.length > 0) {
    return {
      ok: false,
      reason: `尚有 ${pending.length} 項未通過校對：${pending.slice(0, 3).map((i) => i.label).join("、")}${pending.length > 3 ? " 等" : ""}`,
    };
  }

  // 「已修正」只記下修正的文字，不會改到草稿 —— 鎖版發布的是原始草稿。
  // 以前它被當成通過，結果是：校對者寫了「應該是 9 學分」，發布出去的仍是錯的值，
  // 還被標成「已人工校對」。修正必須回到草稿改，改完草稿的 hash 會變，
  // 舊的校對紀錄自動失效，整份重新校對 —— 這樣發布的才是校對過的內容。
  const corrected = view.items.filter((i) => decided.get(i.id)?.status === "corrected");
  if (corrected.length > 0) {
    return {
      ok: false,
      reason:
        `有 ${corrected.length} 項標為「需要修正」：${corrected.slice(0, 3).map((i) => i.label).join("、")}` +
        `${corrected.length > 3 ? " 等" : ""}。修正內容不會自動寫進規則包，請依修正內容改草稿、` +
        `重新上傳（scripts/push-draft.ts）後再校對一次。`,
    };
  }

  const pack = { ...view.draft } as Record<string, unknown>;
  delete pack._draft;
  pack.provenance = "approved";
  pack.approvedBy = reviewer;
  pack.approvedAt = new Date().toISOString().slice(0, 10);
  pack.contentHash = contentHash(pack);

  view.record.lockedAt = new Date().toISOString();
  view.record.lockedBy = reviewer;

  // 有資料庫就發布到資料庫。原本這裡寫進 src/lib/rules/packs/ —— 那是原始碼
  // 目錄，serverless 上唯讀，整條規則產生流程會斷在最後一步。
  if (supabaseConfigured()) {
    const parsed = zRulePack.safeParse(pack);
    if (!parsed.success) {
      return { ok: false, reason: `鎖版前的最後驗證未通過：${parsed.error.issues[0]?.message ?? "未知"}` };
    }
    await publishRulePack({ ...parsed.data, contentHash: pack.contentHash as string }, view.corpus, reviewer);
    await saveRecord(packId, view.record);
    return { ok: true, path: `rule_packs/${packId}` };
  }

  mkdirSync(PACK_DIR, { recursive: true });
  const path = join(PACK_DIR, `${packId}.json`);
  writeFileSync(path, JSON.stringify(pack, null, 2), "utf8");
  await saveRecord(packId, view.record);

  return { ok: true, path };
}

