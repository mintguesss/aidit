import type { RulePack } from "./schema";
import type { Student } from "@/lib/types";

export type TermLimits = { maxCredits: number; minCredits: number };

/**
 * 某位學生在某個學期適用的修課學分上下限。
 *
 * 上下限依學年不同（輔大選課辦法第十一條：第四學年下限由 12 降為 9，
 * 應屆畢業生上限由 25 放寬到 32）。排課要用「排課那個學期」的學年算，
 * 不是現在的學年 —— 大三下學期替大四上排課，用的是大四的上下限。
 *
 * 學年 ＝ 學期的學年度 − 入學學年 ＋ 1。延畢生（第五學年起）沿用最後一條調整。
 * 學期代號看不懂時回傳基本值，不猜。
 */
export function termLimitsFor(pack: RulePack, student: Pick<Student, "admissionYear">, term: string): TermLimits {
  const limits: TermLimits = { maxCredits: pack.termLimits.maxCredits, minCredits: pack.termLimits.minCredits };
  const m = /^(\d{3})-/.exec(term);
  if (!m) return limits;

  const studyYear = Number(m[1]) - student.admissionYear + 1;
  const applicable = pack.termLimits.byStudyYear
    .filter((o) => studyYear >= o.fromYear)
    .sort((a, b) => a.fromYear - b.fromYear);
  for (const o of applicable) {
    if (o.minCredits !== undefined) limits.minCredits = o.minCredits;
    if (o.maxCredits !== undefined) limits.maxCredits = o.maxCredits;
  }
  return limits;
}
