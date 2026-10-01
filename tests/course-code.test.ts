import { describe, it, expect } from "vitest";
import { isCourseCode, findCourseCode, findCourseCodes, COURSE_CODE_RE } from "@/lib/courses/code";
import { COURSE_CODE_RE as FROM_SCHEMA } from "@/lib/rules/schema";

describe("課號格式", () => {
  it("合成資料：兩碼英文＋四碼數字", () => {
    expect(isCourseCode("IM4045")).toBe(true);
    expect(isCourseCode("im4045")).toBe(false);
    expect(isCourseCode("IM40451")).toBe(false);
  });

  it("輔仁大學：五碼數字，開頭的 0 是課號的一部分", () => {
    expect(isCourseCode("02390")).toBe(true);
    expect(isCourseCode("24495")).toBe(true);
    expect(isCourseCode("2390")).toBe(false);
    expect(isCourseCode("023901")).toBe(false);
  });

  it("不是字串就不是課號", () => {
    expect(isCourseCode(2390)).toBe(false);
    expect(isCourseCode(null)).toBe(false);
  });

  it("schema 匯出的是同一個樣式，不是另一份副本", () => {
    expect(FROM_SCHEMA).toBe(COURSE_CODE_RE);
  });
});

describe("從文字裡找課號", () => {
  it("兩種格式都找得到", () => {
    expect(findCourseCode("為什麼沒有 IM4045")).toBe("IM4045");
    expect(findCourseCode("微積分 02390 什麼時候開")).toBe("02390");
  });

  it("不能從九碼學號裡切出五碼", () => {
    // pii-fixture：虛構的九碼學號，驗證不會從中切出五碼
    expect(findCourseCode("我的學號是 410123456")).toBeUndefined();
  });

  it("短於五碼的數字不是課號", () => {
    expect(findCourseCode("學分不要超過 15")).toBeUndefined();
    expect(findCourseCode("我想在 115-1 畢業")).toBeUndefined();
  });

  it("依出現順序列出全部", () => {
    expect(findCourseCodes("先修 02492 與 IM3001，再修 01584")).toEqual(["02492", "IM3001", "01584"]);
  });
});
