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
  demo: { name: "示範學校（合成資料）" },
  fju: { name: "輔仁大學" },
} as const;

export type SchoolId = keyof typeof SCHOOLS;

export const DEFAULT_SCHOOL: SchoolId = "demo";

export function schoolOf(student: Pick<Student, "school">): string {
  return student.school ?? DEFAULT_SCHOOL;
}
