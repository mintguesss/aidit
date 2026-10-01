import { describe, it, expect } from "vitest";
import { takenCourseCodes } from "@/lib/solver/taken";
import { fixture } from "@/lib/providers/fixtures";
import type { CourseRecord } from "@/lib/types";

/**
 * 排課不再建議已修過的課（lib/solver/taken.ts）。
 *
 * 輔大大二的示範學生測出來的：下學期課表排進了大一修過的微積分、會計學、統計學。
 */

const r = (code: string, term: 1 | 2, status: CourseRecord["status"] = "passed", yearLong?: boolean): CourseRecord => ({
  code, name: code, credits: 3, year: 111, term, status, selectType: "required", score: null, ...(yearLong ? { yearLong } : {}),
});

describe("已修過的課號", () => {
  it("一般學期課修過就算", () => {
    expect(takenCourseCodes([r("01558", 1)], { yearLongCourses: [] }).has("01558")).toBe(true);
  });

  it("不及格、停修的不算 —— 還要再排", () => {
    const t = takenCourseCodes([r("01558", 1, "failed"), r("01584", 1, "withdrawn")], { yearLongCourses: [] });
    expect(t.size).toBe(0);
  });

  it("正在修的算：這學期在修，下學期不再建議", () => {
    expect(takenCourseCodes([r("01558", 1, "in_progress")], { yearLongCourses: [] }).has("01558")).toBe(true);
  });

  it("學年課只修了上學期：下學期那一半還要排", () => {
    expect(takenCourseCodes([r("02390", 1)], { yearLongCourses: ["02390"] }).has("02390")).toBe(false);
  });

  it("學年課上下都修過才算修畢", () => {
    expect(takenCourseCodes([r("02390", 1), r("02390", 2)], { yearLongCourses: ["02390"] }).has("02390")).toBe(true);
  });

  it("規則包沒列、但修課紀錄標了學年課的（國文、外國語文）一樣處理", () => {
    expect(takenCourseCodes([r("00764", 1, "passed", true)], { yearLongCourses: [] }).has("00764")).toBe(false);
    expect(
      takenCourseCodes([r("00764", 1, "passed", true), r("00764", 2, "passed", true)], { yearLongCourses: [] }).has("00764"),
    ).toBe(true);
  });

  it("輔大大二：大一大二修過的必修都排除，大三的作業系統、專題還沒修", () => {
    const t = takenCourseCodes(fixture("fju-im-111-year2").record.courses, { yearLongCourses: [] });
    for (const code of ["02390", "02412", "02222", "02457", "00764", "00772", "24495"]) expect(t.has(code), code).toBe(true);
    for (const code of ["01558", "04317", "00007"]) expect(t.has(code), code).toBe(false);
  });
});
