import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/store/paths";
import { contentHash } from "@/lib/util/identity";
import { supabaseClient, supabaseConfigured } from "@/lib/store/supabase";
import { publishRulePack } from "@/lib/rules/published";
import { zRulePack } from "@/lib/rules/schema";

/**
 * 人工校對紀錄（docs/BACKEND.md §2）。
 *
 * 「校對紀錄要留（誰、何時），決賽可作為資料品質的證據。」
 * 因此本檔只負責：讀草稿、記錄逐條 approve／修正、在全數通過後鎖版。
 */

const DRAFT_DIR = dataDir("drafts");
const REVIEW_DIR = dataDir("reviews");
const PACK_DIR = join(process.cwd(), "src", "lib", "rules", "packs");
const CORPUS_DIR = join(process.cwd(), "src", "lib", "rules", "corpus");

export type ReviewDecision = {
  itemId: string;
  status: "approved" | "corrected" | "rejected";
  /** 修正後的內容（status = corrected 時） */
  correction?: string;
  note?: string;
  reviewer: string;
  decidedAt: string;
};

export type ReviewRecord = {
  packId: string;
  /** 草稿的 content hash，草稿變動後舊的校對紀錄即失效 */
  draftHash: string;
  decisions: ReviewDecision[];
  lockedAt?: string;
  lockedBy?: string;
};

export type ReviewItem = {
  id: string;
  kind: "category" | "subRule" | "ambiguity" | "graduationCheck" | "overflowPolicy" | "meta";
  label: string;
  /** 抽取結果的呈現內容 */
  extracted: string;
  docId: string;
  locator: string;
  quote?: string;
  /** 原文中 quote 前後的上下文，供校對時對照 */
  context?: { before: string; match: string; after: string } | null;
};

export type DraftView = {
  packId: string;
  draft: Record<string, unknown>;
  draftHash: string;
  items: ReviewItem[];
  record: ReviewRecord;
};

export async function listDrafts(): Promise<string[]> {
  if (!existsSync(DRAFT_DIR)) return [];
  return readdirSync(DRAFT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export async function loadDraft(packId: string): Promise<DraftView | null> {
  const p = join(DRAFT_DIR, `${packId}.json`);
  if (!/^[a-z0-9-]+$/i.test(packId) || !existsSync(p)) return null;
  const draft = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  const draftHash = contentHash(draft);
  return { packId, draft, draftHash, items: toItems(draft), record: await loadRecord(packId, draftHash) };
}

/**
 * 校對紀錄的讀寫。
 *
 * 含校對人姓名或代號 —— 那是承辦人員的個資，不是學生的，但一樣要有管轄。
 * 設定了 Supabase 就存資料庫；否則落到 .data/reviews/。在 serverless 上
 * 後者等於不存在（/tmp 換實例就沒了），而「誰在什麼時候通過了哪一條」
 * 正是資料品質的證據，不能留不住。
 */
async function loadRecord(packId: string, draftHash: string): Promise<ReviewRecord> {
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

  // 草稿換過就代表被重新抽取過，舊紀錄不得沿用
  return stored && stored.draftHash === draftHash ? stored : fresh;
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
  const record = view.record;
  record.decisions = [...record.decisions.filter((d) => d.itemId !== decision.itemId), decision];
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
    const corpus = corpusOf(view.draft);
    await publishRulePack({ ...parsed.data, contentHash: pack.contentHash as string }, corpus, reviewer);
    await saveRecord(packId, view.record);
    return { ok: true, path: `rule_packs/${packId}` };
  }

  mkdirSync(PACK_DIR, { recursive: true });
  const path = join(PACK_DIR, `${packId}.json`);
  writeFileSync(path, JSON.stringify(pack, null, 2), "utf8");
  await saveRecord(packId, view.record);

  return { ok: true, path };
}

/** 草稿宣告的原文語料。鎖版時要一併發布，否則引用回查找不到原文。 */
function corpusOf(draft: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const docs = (draft.documents as { id: string; corpusFile?: string }[] | undefined) ?? [];
  for (const d of docs) {
    if (!d.corpusFile) continue;
    const p = join(CORPUS_DIR, d.corpusFile);
    if (existsSync(p)) map.set(d.id, readFileSync(p, "utf8"));
  }
  return map;
}

// ------------------------------------------------------- 草稿 → 校對項目

function toItems(draft: Record<string, unknown>): ReviewItem[] {
  const items: ReviewItem[] = [];
  const docs = (draft.documents as { id: string; corpusFile?: string }[] | undefined) ?? [];
  const corpus = new Map<string, string>();
  for (const d of docs) {
    if (!d.corpusFile) continue;
    const p = join(CORPUS_DIR, d.corpusFile);
    if (existsSync(p)) corpus.set(d.id, readFileSync(p, "utf8"));
  }

  const push = (
    id: string,
    kind: ReviewItem["kind"],
    label: string,
    extracted: string,
    c: { docId?: string; locator?: string; quote?: string } | undefined,
  ) => {
    items.push({
      id,
      kind,
      label,
      extracted,
      docId: c?.docId ?? "",
      locator: c?.locator ?? "",
      quote: c?.quote,
      context: c?.quote ? locate(corpus.get(c.docId ?? "") ?? "", c.quote) : null,
    });
  };

  push(
    "meta",
    "meta",
    "規則包基本資訊",
    `畢業最低學分 ${draft.minCredits}；系所 ${draft.dept}；入學學年 ${draft.admissionYear}；學制 ${draft.program}`,
    undefined,
  );

  type Cat = {
    id: string;
    name: string;
    credits: number;
    match: { type: string };
    citation: { docId: string; locator: string; quote?: string };
    subRules?: { id: string; name: string; citation: { docId: string; locator: string; quote?: string } }[];
    ambiguities?: {
      id: string;
      description: string;
      citation: { docId: string; locator: string; quote?: string };
    }[];
  };

  for (const cat of (draft.categories as Cat[] | undefined) ?? []) {
    push(`category:${cat.id}`, "category", `類別　${cat.name}`, `${cat.credits} 學分；比對方式 ${cat.match.type}`, cat.citation);
    for (const s of cat.subRules ?? []) {
      push(`subRule:${s.id}`, "subRule", `子規則　${s.name}`, JSON.stringify(s), s.citation);
    }
    for (const a of cat.ambiguities ?? []) {
      push(`ambiguity:${a.id}`, "ambiguity", `待確認規則　${a.description}`, JSON.stringify(a), a.citation);
    }
  }

  type Check = { id: string; name: string; rule: string; citation: { docId: string; locator: string; quote?: string } };
  for (const g of (draft.graduationChecks as Check[] | undefined) ?? []) {
    push(`check:${g.id}`, "graduationCheck", `畢業條件　${g.name}`, `判定方式 ${g.rule}`, g.citation);
  }

  const policies = (draft.overflowPolicy as Record<string, { citation: { docId: string; locator: string; quote?: string } }> | undefined) ?? {};
  for (const [k, v] of Object.entries(policies)) {
    push(`overflow:${k}`, "overflowPolicy", `超修規定　${k}`, JSON.stringify(v), v.citation);
  }

  return items;
}

/** 在原文中定位 quote，回傳前後文供高亮 */
function locate(source: string, quote: string): ReviewItem["context"] {
  const idx = source.indexOf(quote);
  if (idx >= 0) {
    return {
      before: source.slice(Math.max(0, idx - 80), idx),
      match: quote,
      after: source.slice(idx + quote.length, idx + quote.length + 80),
    };
  }
  return null;
}
