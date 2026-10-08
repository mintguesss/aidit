import { verifyCitation } from "@/lib/verify/citation";
import type { BaselineAnswer } from "./prompt";
import type { GraduationVerdict, RealCase } from "./cases";

/**
 * 基準 C 的評分。跟 golden set 的評測器同一套分類：
 *   correct  全部答對
 *   wrong    給了數字但數字錯（只要一處就算）—— 這是核心指標
 *   abstain  沒有錯，但有地方選擇轉人工
 * 另外單獨標出「誤判可畢業」：還不能畢業卻回答 yes，是最嚴重的錯。
 */

export type Outcome = "correct" | "wrong" | "abstain";

export type CategoryVerdict = { name: string; expected: number; got: number | null; outcome: Outcome };

export type RunScore = {
  outcome: Outcome;
  categories: CategoryVerdict[];
  totalUnmet: { expected: number; got: number | null; outcome: Outcome };
  domains: { expected: string[]; got: string[] | null; outcome: Outcome };
  canGraduate: { expected: GraduationVerdict; got: GraduationVerdict; outcome: Outcome; falseGraduate: boolean };
  citations: { total: number; verified: number; failed: { quote: string; reason: string }[] };
  /** 給人看的錯誤說明 */
  errors: string[];
};

const key = (s: string) => s.replace(/\s|課程|領域/g, "");

function numberOutcome(expected: number, got: number | null | undefined): Outcome {
  if (got === null || got === undefined) return "abstain";
  return got === expected ? "correct" : "wrong";
}

export function scoreRun(answer: BaselineAnswer, c: RealCase, corpus: Map<string, string>): RunScore {
  const errors: string[] = [];

  const categories = c.expect.categories.map((exp): CategoryVerdict => {
    const got = answer.categories.find((x) => key(x.name) === key(exp.name));
    // 漏掉某一類等於沒回答，算轉人工，不算錯
    const value = got && !got.needsReview ? got.unmet : null;
    const outcome = numberOutcome(exp.unmet, value);
    if (outcome === "wrong") errors.push(`${exp.name}：還差 ${value}，應為 ${exp.unmet}`);
    return { name: exp.name, expected: exp.unmet, got: value, outcome };
  });

  const totalOutcome = numberOutcome(c.expect.totalUnmet, answer.totalUnmet);
  if (totalOutcome === "wrong") errors.push(`合計還差 ${answer.totalUnmet}，應為 ${c.expect.totalUnmet}`);

  const expDomains = c.expect.missingGenEdDomains.map(key).sort();
  const gotDomains = answer.missingGenEdDomains?.map(key).sort() ?? null;
  const domainOutcome: Outcome =
    gotDomains === null ? "abstain" : gotDomains.join("|") === expDomains.join("|") ? "correct" : "wrong";
  if (domainOutcome === "wrong") {
    errors.push(`通識缺的領域：${gotDomains!.join("、") || "（無）"}，應為 ${expDomains.join("、") || "（無）"}`);
  }

  const expGrad = c.expect.canGraduate;
  const gotGrad = answer.canGraduate;
  const falseGraduate = gotGrad === "yes" && expGrad !== "yes";
  const gradOutcome: Outcome =
    gotGrad === expGrad ? "correct" : gotGrad === "needs-review" ? "abstain" : "wrong";
  if (falseGraduate) errors.push("誤判可畢業：回答 yes，實際上不能確定可以畢業");
  else if (gradOutcome === "wrong") errors.push(`能否畢業：回答 ${gotGrad}，應為 ${expGrad}`);

  const verdicts = answer.citations.map((x) =>
    verifyCitation({ docId: x.docId, docTitle: x.docId, locator: "", quote: x.quote }, corpus),
  );
  const failed = verdicts
    .filter((v) => !v.ok)
    .map((v) => ({ quote: v.citation.quote ?? "", reason: v.reason ?? "unknown" }));

  const parts = [...categories.map((x) => x.outcome), totalOutcome, domainOutcome, gradOutcome];
  const outcome: Outcome = parts.includes("wrong") ? "wrong" : parts.includes("abstain") ? "abstain" : "correct";

  return {
    outcome,
    categories,
    totalUnmet: { expected: c.expect.totalUnmet, got: answer.totalUnmet, outcome: totalOutcome },
    domains: { expected: c.expect.missingGenEdDomains, got: answer.missingGenEdDomains, outcome: domainOutcome },
    canGraduate: { expected: expGrad, got: gotGrad, outcome: gradOutcome, falseGraduate },
    citations: { total: verdicts.length, verified: verdicts.length - failed.length, failed },
    errors,
  };
}

/**
 * 同一題跑幾次，答案是否完全一樣。比的是會影響學生決定的部分：
 * 各類還差幾學分、能否畢業、缺哪些領域。
 */
export function consistency(answers: BaselineAnswer[]): { consistent: boolean; distinct: number } {
  const sig = (a: BaselineAnswer) =>
    JSON.stringify([
      [...a.categories].sort((x, y) => key(x.name).localeCompare(key(y.name))).map((x) => [key(x.name), x.needsReview ? null : x.unmet]),
      a.canGraduate,
      a.missingGenEdDomains?.map(key).sort() ?? null,
    ]);
  const distinct = new Set(answers.map(sig)).size;
  return { consistent: distinct <= 1, distinct };
}
