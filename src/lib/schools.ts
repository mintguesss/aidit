import type { Student } from "@/lib/types";

/**
 * 系統認得的學校。
 *
 * 原本整個系統假設只有一所學校。接上第一所真實學校（輔大）時，合成的 im-111 與輔大的
 * 資管 111 學年、日間部完全同一組系所與學年 —— 只靠系所代碼區分的話會撞在一起，
 * 開課資料也會混用（合成資料的學生被排到輔大的課）。
 *
 * 沒有填學校的學生與規則包一律是 "demo"（合成資料），所以既有資料不必改。
 */
export const SCHOOLS = {
  demo: { name: "示範學校（合成資料）", aliases: [] as string[] },
  // 對話裡學生怎麼稱呼自己的學校。判斷「他校事務」時要先拿掉，不然輔大學生問「輔大的規定」會被當成問別校
  fju: { name: "輔仁大學", aliases: ["輔仁大學", "輔大", "輔仁"] },
} as const;

export type SchoolId = keyof typeof SCHOOLS;

export const DEFAULT_SCHOOL: SchoolId = "demo";

export function schoolOf(student: Pick<Student, "school">): string {
  return student.school ?? DEFAULT_SCHOOL;
}

/** 把學生自己學校的稱呼換成「本校」：對話規則判斷「他校」時用 */
export function withoutOwnSchool(text: string, school: string): string {
  const aliases = SCHOOLS[school as SchoolId]?.aliases ?? [];
  return aliases.reduce((t, a) => t.split(a).join("本校"), text);
}
