import type { AuditResult, CourseRecord, StudentRecord } from "@/lib/types";
import type { RulePack, RuleCategory } from "@/lib/rules/schema";
import { cmp } from "@/lib/util/text";
import { courseNameMatches } from "@/lib/courses/names";

/**
 * 基準方案（docs/SPEC.md §10）。
 *
 * 核心論述：在畢業審查場域，答錯的代價遠高於不答。
 * 因此比較的重點不是「誰答得多」，而是**誰在不確定時仍然給了數字**。
 */

export type BaselineOutcome = {
  /** 各類別未修學分；null 表示該方案選擇不作答 */
  unmetByCategory: Record<string, number> | null;
  totalUnmet: number | null;
  /** 轉人工／不作答的項目數 */
  abstained: number;
  note: string;
};

/**
 * 基準 B：固定 workflow（無狀態、不檢索補充依據、不處理規則缺口）。
 *
 * 特徵是「什麼都答」：命中規則缺口的課程照樣採計，公告衝突視而不見。
 * 它會在 demo 這類案例上給出比我們更「漂亮」的答案 —— 而那個答案是錯的。
 */
export function fixedWorkflow(record: StudentRecord, pack: RulePack): BaselineOutcome {
  const counted = record.courses.filter(
    (c) => c.status === "passed" || c.status === "waived" || c.status === "in_progress",
  );
  const seen = new Set<string>();
  const unique = counted.filter((c) => {
    const k = c.equivalentOf ?? c.code;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const filled: Record<string, number> = {};
  for (const cat of pack.categories) filled[cat.id] = 0;

  // 貪婪：課程依課號升冪，指派到第一個符合的類別。這正是 docs/BACKEND.md §1 警告的做法。
  for (const c of [...unique].sort((a, b) => cmp(a.code, b.code))) {
    const cat = pack.categories.find((x) => greedyMatch(x, c, pack));
    if (cat) filled[cat.id] = (filled[cat.id] ?? 0) + c.credits;
  }

  const unmetByCategory: Record<string, number> = {};
  for (const cat of pack.categories) {
    unmetByCategory[cat.id] = Math.max(0, cat.credits - (filled[cat.id] ?? 0));
  }
  return {
    unmetByCategory,
    totalUnmet: Object.values(unmetByCategory).reduce((a, b) => a + b, 0),
    abstained: 0,
    note: "貪婪指派、不處理規則缺口與公告衝突，所有項目一律作答。",
  };
}

function greedyMatch(cat: RuleCategory, c: CourseRecord, pack: RulePack): boolean {
  const code = c.equivalentOf ?? c.code;
  switch (cat.match.type) {
    case "courseList":
      return cat.match.codes.includes(code);
    case "courseNames":
      // 與引擎同一個規則。基準要比的是指派策略，不是比對方式
      return courseNameMatches(cat.match, c.name);
    case "selectType":
      return c.selectType === cat.match.value;
    case "deptElective":
      return c.selectType === "elective" && (c.offeringDept ?? pack.dept) === cat.match.dept;
    case "anyPassed":
      return true;
  }
}

/**
 * 基準 C：單次 LLM（所有規章塞進 context 問一次）。
 *
 * 需要 ANTHROPIC_API_KEY；沒有金鑰時回報「未執行」而不是偽造數字 ——
 * 評測報告上出現沒跑過的基準，比少一個基準嚴重得多。
 */
export type SingleLlmStatus = { ran: false; reason: string } | { ran: true; outcome: BaselineOutcome };

export function singleLlmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** 我們的系統在同一案例上的結果，轉為可比較的形狀 */
export function ourOutcome(audit: AuditResult): BaselineOutcome {
  const unmetByCategory: Record<string, number> = {};
  for (const c of audit.categories) unmetByCategory[c.id] = c.unmet;
  return {
    unmetByCategory,
    totalUnmet: audit.unmet,
    abstained: audit.holds.length,
    note: "命中規則缺口者移出計算並轉人工；引用須回查原文。",
  };
}
