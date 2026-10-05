import type { CourseRecord } from "@/lib/types";
import type { RulePack } from "@/lib/rules/schema";

/**
 * 已修畢（或正在修）的課號：排課時不再建議。
 *
 * 以前求解器完全沒有這一步 —— 合成資料的開課清單裡剛好沒有學生修過的必修，所以從沒出事。
 * 接上輔大的真實開課後，微積分、統計學每學期都開，大二學生的下學期課表就被排進了大一修過的微積分。
 *
 * 學年課（上下學期共用課號）要上下兩半都修過才算修畢：只修了上學期的，下學期那一班還要排。
 * 學年課的判斷與審查引擎一致：規則包的 yearLongCourses，加上修課紀錄自己帶的 yearLong 標記。
 *
 * 正在修的也算：這學期在修的課，不會建議下學期再修一次（真的沒過，成績出來再排）。
 */
export function takenCourseCodes(courses: CourseRecord[], pack: Pick<RulePack, "yearLongCourses">): Set<string> {
  const counted = courses.filter((c) => c.status === "passed" || c.status === "waived" || c.status === "in_progress");
  const codeOf = (c: CourseRecord) => c.equivalentOf ?? c.code;
  const yearLong = new Set([...pack.yearLongCourses, ...counted.filter((c) => c.yearLong).map(codeOf)]);

  const halves = new Map<string, Set<string>>();
  for (const c of counted) {
    const code = codeOf(c);
    if (!code) continue;
    const set = halves.get(code) ?? new Set<string>();
    // 暑修可以補任一半，記成 summer；只有上下學期都到齊才算修畢
    set.add(String(c.term));
    halves.set(code, set);
  }

  const out = new Set<string>();
  for (const [code, terms] of halves) {
    if (!yearLong.has(code)) out.add(code);
    else if ((terms.has("1") && terms.has("2")) || terms.size >= 2) out.add(code);
  }
  return out;
}

/**
 * 學年課只修了一半（上學期修過、下學期還沒）：下學期那一半要接著修。
 *
 * 輔大的國文、外國語文、微積分、會計學都是上下學期接著修的學年課。大一上結束時，
 * 排課要優先把下半排進來 —— 不然它會拿別的必修（例如大二的統計學下半）湊學分。
 */
export function continuingCourseCodes(courses: CourseRecord[], pack: Pick<RulePack, "yearLongCourses">): Set<string> {
  const passed = courses.filter((c) => c.status === "passed" || c.status === "waived" || c.status === "in_progress");
  const codeOf = (c: CourseRecord) => c.equivalentOf ?? c.code;
  const yearLong = new Set([...pack.yearLongCourses, ...passed.filter((c) => c.yearLong).map(codeOf)]);
  const taken = takenCourseCodes(courses, pack);
  return new Set(passed.map(codeOf).filter((code) => code && yearLong.has(code) && !taken.has(code)));
}
