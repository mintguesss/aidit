import { describe, it, expect } from "vitest";
import { courseNameMatches } from "@/lib/courses/names";

/** 課名比對只有「完全相同」與「開頭相同」兩種，不做模糊比對（lib/courses/names.ts） */
describe("課名比對", () => {
  const rule = { names: ["國文"], prefixes: ["外國語文"] };

  it("完全相同，忽略空白", () => {
    expect(courseNameMatches(rule, "國文")).toBe(true);
    expect(courseNameMatches(rule, "國 文")).toBe(true);
  });

  it("完全比對不接受多字：「國文閱讀與寫作」不是「國文」", () => {
    expect(courseNameMatches(rule, "國文閱讀與寫作")).toBe(false);
  });

  it("開頭相同", () => {
    expect(courseNameMatches(rule, "外國語文(中級英文)")).toBe(true);
    expect(courseNameMatches(rule, "外國語文（基礎日文）")).toBe(true);
  });

  it("字出現在中間不算開頭", () => {
    expect(courseNameMatches(rule, "進階外國語文")).toBe(false);
  });

  it("沒有 prefixes 時只做完全比對", () => {
    expect(courseNameMatches({ names: ["國文"] }, "國文(一)")).toBe(false);
  });
});
