import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/store/paths";
import { contentHash } from "@/lib/util/identity";

/**
 * 人工校對紀錄（BACKEND.md §2）。
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

export function listDrafts(): string[] {
  if (!existsSync(DRAFT_DIR)) return [];
  return readdirSync(DRAFT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function loadDraft(packId: string): DraftView | null {
  const p = join(DRAFT_DIR, `${packId}.json`);
  if (!/^[a-z0-9-]+$/i.test(packId) || !existsSync(p)) return null;
  const draft = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  const draftHash = contentHash(draft);
  return { packId, draft, draftHash, items: toItems(draft), record: loadRecord(packId, draftHash) };
}

function loadRecord(packId: string, draftHash: string): ReviewRecord {
  const p = join(REVIEW_DIR, `${packId}.json`);
  if (!existsSync(p)) return { packId, draftHash, decisions: [] };
  const r = JSON.parse(readFileSync(p, "utf8")) as ReviewRecord;
  // 草稿換過就代表被重新抽取過，舊紀錄不得沿用
  return r.draftHash === draftHash ? r : { packId, draftHash, decisions: [] };
}

export function saveDecision(packId: string, decision: ReviewDecision): ReviewRecord {
  const view = loadDraft(packId);
  if (!view) throw new Error(`查無草稿 ${packId}`);
  const record = view.record;
  record.decisions = [...record.decisions.filter((d) => d.itemId !== decision.itemId), decision];
  mkdirSync(REVIEW_DIR, { recursive: true });
  writeFileSync(join(REVIEW_DIR, `${packId}.json`), JSON.stringify(record, null, 2), "utf8");
  return record;
}

/**
 * 鎖版：全數 approved 後才允許，並寫入 provenance=approved、approvedBy 與 contentHash。
 * 只要有一條被 rejected 或未決，就不得鎖版 —— 半套校對的規則包比沒有更危險。
 */
export function lockPack(packId: string, reviewer: string): { ok: true; path: string } | { ok: false; reason: string } {
  const view = loadDraft(packId);
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

  mkdirSync(PACK_DIR, { recursive: true });
  const path = join(PACK_DIR, `${packId}.json`);
  writeFileSync(path, JSON.stringify(pack, null, 2), "utf8");

  view.record.lockedAt = new Date().toISOString();
  view.record.lockedBy = reviewer;
  writeFileSync(join(REVIEW_DIR, `${packId}.json`), JSON.stringify(view.record, null, 2), "utf8");

  return { ok: true, path };
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
