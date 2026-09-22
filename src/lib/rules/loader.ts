import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zRulePack, type RulePack } from "./schema";
import type { Student, TransferApproval } from "@/lib/types";
import { contentHash } from "@/lib/util/identity";

/**
 * 規則包載入與版本判定（docs/SPEC.md §6 step 2）。
 * 啟動時一次載入記憶體（docs/BACKEND.md §8），執行期只查表。
 */

const PACK_DIR = join(process.cwd(), "src", "lib", "rules", "packs");
const CORPUS_DIR = join(process.cwd(), "src", "lib", "rules", "corpus");

let packsCache: RulePack[] | null = null;
let corpusCache: Map<string, string> | null = null;

/**
 * 執行期發布的規則包與語料，由 `preloadPublishedRules()` 填入。
 *
 * **刻意保持同步介面。** `loadCorpus()` 與 `citationVerify()` 目前都是同步的，
 * 改成 async 會一路傳染到審查引擎。所以資料庫那一側在非同步的入口點先載入
 * 記憶體，同步存取照舊 —— 這也符合 docs/BACKEND.md §8「啟動時一次載入記憶體」。
 */
let published: { packs: RulePack[]; corpus: Map<string, string> } = { packs: [], corpus: new Map() };
let preloadedAt = 0;
const PRELOAD_TTL_MS = 10 * 60 * 1000;

/**
 * 從資料庫載入已發布的規則包。沒有設定 Supabase 時是 no-op。
 *
 * 由非同步的入口點呼叫（`getAuditSession`）。失敗不中斷 —— repo 裡的基準
 * 版本仍然可用，退化成「看不到新發布的規則包」，而不是整個系統停擺。
 */
export async function preloadPublishedRules(force = false): Promise<void> {
  if (!force && Date.now() - preloadedAt < PRELOAD_TTL_MS) return;
  try {
    const { fetchPublishedRules } = await import("./published");
    published = await fetchPublishedRules();
    preloadedAt = Date.now();
    packsCache = null;
    corpusCache = null;
  } catch (e) {
    console.warn(`[aidit][rules] 讀取已發布規則包失敗，改用 repo 版本：${String(e)}`);
    preloadedAt = Date.now();
  }
}

export function loadRulePacks(): RulePack[] {
  if (packsCache) return packsCache;
  const files = existsSync(PACK_DIR) ? readdirSync(PACK_DIR).filter((f) => f.endsWith(".json")) : [];
  const packs = files.map((f) => {
    const raw: unknown = JSON.parse(readFileSync(join(PACK_DIR, f), "utf8"));
    const parsed = zRulePack.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`規則包 ${f} 未通過 schema 驗證：\n${formatIssues(parsed.error)}`);
    }
    return { ...parsed.data, contentHash: parsed.data.contentHash ?? contentHash(raw) };
  });
  // 同 id 以資料庫版本為準：它較新，而且經過人工校對鎖版
  const byId = new Map<string, RulePack>(packs.map((p) => [p.id, p]));
  for (const p of published.packs) byId.set(p.id, p);

  packsCache = [...byId.values()];
  return packsCache;
}

function formatIssues(err: { issues: { path: (string | number | symbol)[]; message: string }[] }): string {
  return err.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

/** 原文語料：citation.verify 的比對對象 */
export function loadCorpus(): Map<string, string> {
  if (corpusCache) return corpusCache;
  const map = new Map<string, string>();
  for (const pack of loadRulePacks()) {
    for (const doc of pack.documents) {
      if (!doc.corpusFile) continue;
      const path = join(CORPUS_DIR, doc.corpusFile);
      if (existsSync(path)) map.set(doc.id, readFileSync(path, "utf8"));
    }
  }
  // 公告語料同樣進 corpus，讓衝突解消結論也能被驗證
  for (const [id, file] of ANNOUNCEMENT_CORPUS) {
    const path = join(CORPUS_DIR, file);
    if (existsSync(path)) map.set(id, readFileSync(path, "utf8"));
  }
  // 資料庫版本覆寫同 id 的 repo 版本
  for (const [id, body] of published.corpus) map.set(id, body);

  corpusCache = map;
  return map;
}

const ANNOUNCEMENT_CORPUS: [string, string][] = [
  ["ann-ge-114", "ann-ge-114.txt"],
  ["ann-eng-cert", "ann-eng-cert.txt"],
];

export type ResolveOutcome =
  | { ok: true; pack: RulePack }
  | { ok: false; reason: "admission_year_mismatch"; detail: string }
  | { ok: false; reason: "pack_not_found"; detail: string }
  | { ok: false; reason: "pack_not_approved"; detail: string };

/**
 * 以「學籍入學學年」綁定規則包。
 *
 * 學籍入學學年 ≠ 實際入學學年（轉系、轉學、復學）時，一律全案轉人工：
 * 此處不做任何猜測，因為猜錯的代價是叫學生多讀一學期或少讀一學期。
 */
export function resolveRulePack(student: Student, transfer?: TransferApproval): ResolveOutcome {
  if (student.admissionYear !== student.actualAdmissionYear) {
    // 已完成個案認定的轉系生：認定結果就是規劃表要求的那道人工程序，
    // 它已經做完了，系統沒有理由再停一次。
    const approved =
      transfer !== undefined &&
      transfer.toDept === student.dept &&
      transfer.accepted.length > 0;
    if (!approved) {
      return {
        ok: false,
        reason: "admission_year_mismatch",
        detail:
          `學籍入學學年 ${student.admissionYear} 與實際入學學年 ${student.actualAdmissionYear} 不一致，` +
          `依規劃表第 1 頁第二點應送系課程委員會個案認定。` +
          `尚未取得學分採計認定結果，系統停止判定 —— ` +
          `在認定之前，「哪一門課採計為什麼」沒有任何規則可以推導。`,
      };
    }
  }
  const pack = loadRulePacks().find(
    (p) =>
      p.dept === student.dept &&
      p.admissionYear === student.admissionYear &&
      p.program === student.program,
  );
  if (!pack) {
    return {
      ok: false,
      reason: "pack_not_found",
      detail: `尚未支援此系所／學年度：${student.dept} ${student.admissionYear} 學年度（${student.program === "day" ? "日" : "夜"}）。`,
    };
  }
  if (pack.provenance === "draft") {
    return {
      ok: false,
      reason: "pack_not_approved",
      detail: `規則包 ${pack.id} 尚未完成人工校對（provenance=draft），不得用於判定。`,
    };
  }
  return { ok: true, pack };
}

/** 測試用：清掉快取 */
export function __resetRuleCache(): void {
  packsCache = null;
  corpusCache = null;
  published = { packs: [], corpus: new Map() };
  preloadedAt = 0;
}
