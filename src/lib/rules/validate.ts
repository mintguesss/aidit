import { describeCourseCodeFormats } from "@/lib/courses/code";
import { COURSE_CODE_RE, type RulePack, type RuleCitation } from "@/lib/rules/schema";
import { normalize, fuzzyBestMatch, numeralsOf } from "@/lib/util/text";

/**
 * 規則包自動驗證（docs/BACKEND.md §2）。
 *
 * 兩個地方用：`scripts/validate-rulepack.ts`（草稿進校對前、CI 第 7 項），
 * 以及校對頁的「直接修改」（lib/review/edit.ts）—— 校對者改出來的內容要過同一套檢查，
 * 不能因為是從網頁改的就放寬。
 *
 * 抽取時沒留 quote 的欄位，後面就無法驗證，等同於沒有依據 —— 因此缺 quote 直接視為錯誤。
 */

export type Issue = { level: "error" | "warn"; message: string };

const FUZZY_MIN = 0.9;

/** corpus：docId → 原文。沒有語料的文件不在這裡檢查（呼叫端自己回報） */
export function validatePack(pack: RulePack, corpus: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warn", message });

  // 1. 類別學分加總 === minCredits（schema 已檢查，此處保留以便報告可讀）
  const sum = pack.categories.reduce((a, c) => a + c.credits, 0);
  if (sum !== pack.minCredits) err(`類別學分加總 ${sum} ≠ minCredits ${pack.minCredits}`);

  // 2. 課號格式
  for (const cat of pack.categories) {
    if (cat.match.type !== "courseList") continue;
    for (const code of cat.match.codes) {
      if (!COURSE_CODE_RE.test(code)) err(`類別 ${cat.id} 的課號 ${code} 不符合任何已知課號格式（${describeCourseCodeFormats()}）`);
    }
  }

  // 3. 課號不得跨類別重複（同一門必修不能同時列在兩張科目表上）
  const seen = new Map<string, string>();
  for (const cat of pack.categories) {
    if (cat.match.type !== "courseList") continue;
    for (const code of cat.match.codes) {
      const prev = seen.get(code);
      if (prev) err(`課號 ${code} 同時出現在 ${prev} 與 ${cat.id}`);
      seen.set(code, cat.id);
    }
  }

  // 4. 每一條 citation 的 quote 必須能回查原文
  const check = (c: RuleCitation, where: string) => {
    if (!c.quote) {
      err(`${where} 未留下 quote —— 抽取時沒留 quote 的欄位，後面就無法驗證，等同於沒有依據`);
      return;
    }
    const src = corpus.get(c.docId);
    if (src === undefined) return;
    const q = normalize(c.quote);
    const body = normalize(src);
    if (body.includes(q)) return;
    const best = fuzzyBestMatch(q, body);
    if (best.ratio >= FUZZY_MIN) {
      // 與 citation.verify 同一條規則：夠像不夠，數字必須完全一樣
      if (numeralsOf(q).join("|") !== numeralsOf(best.window).join("|")) {
        err(
          `${where} 的數字與原文不符（引文 ${numeralsOf(q).join("、") || "無"}；` +
            `原文 ${numeralsOf(best.window).join("、") || "無"}；相似度 ${(best.ratio * 100).toFixed(1)}%）`,
        );
        return;
      }
      warn(`${where} 僅以模糊比對通過（相似度 ${(best.ratio * 100).toFixed(1)}%），建議校對原文`);
      return;
    }
    err(`${where} 的 quote 在原文中查無相符片段（最佳相似度 ${(best.ratio * 100).toFixed(1)}%）`);
  };

  pack.categories.forEach((cat) => {
    check(cat.citation, `類別 ${cat.id}`);
    cat.subRules.forEach((s) => check(s.citation, `類別 ${cat.id} 的 subRule ${s.id}`));
    cat.ambiguities.forEach((a) => check(a.citation, `類別 ${cat.id} 的 ambiguity ${a.id}`));
  });
  pack.graduationChecks.forEach((g) => check(g.citation, `畢業條件 ${g.id}`));
  Object.entries(pack.overflowPolicy).forEach(([k, v]) => check(v.citation, `overflowPolicy ${k}`));
  pack.termLimits.citations.forEach((c, i) => check(c, `修課學分上下限 #${i + 1}`));
  if (pack.minCreditsCitation) check(pack.minCreditsCitation, "畢業最低學分");

  // 5. 鎖版狀態
  if (pack.provenance === "approved" && !pack.approvedBy) {
    err("provenance=approved 但未記錄校對人（approvedBy）");
  }
  if (pack.provenance === "synthetic") {
    warn("本規則包為合成資料，僅供 Demo 與評測，不得用於實際審查");
  }

  return issues;
}
