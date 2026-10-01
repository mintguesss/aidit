import { describe, it, expect } from "vitest";
import { allOfferings, offeringsFor, activeCourseCodes, remainingSeats } from "@/lib/offerings";
import { answerCourseInfo } from "@/lib/chat/capabilities";
import { parseSlots } from "@/lib/solver/slots";

/**
 * 開課資料依學校區分。
 * 排課與「用課名找課」一定要限定學校，否則示範學生會被排到輔大的課，
 * 問課程資訊也會拿到別校的時段與教師。
 */

describe("開課資料依學校", () => {
  it("不指定學校時預設是合成資料，不會混進輔大的課", () => {
    expect(offeringsFor(115, 2).every((o) => o.school === "demo")).toBe(true);
  });

  it("輔大 115-2 有 34 個開課班級，都是輔大的", () => {
    const fju = offeringsFor(115, 2, "fju");
    expect(fju).toHaveLength(34);
    expect(fju.every((o) => o.school === "fju")).toBe(true);
  });

  it("輔大的時段全部解析得了（輔大節次代號）；沒排時間的課寫「時間另訂」", () => {
    for (const o of allOfferings("fju")) {
      expect(o.slotsUnknown, `${o.name} ${o.rawSlotText}`).toBe(false);
      if (o.rawSlotText !== "時間另訂") expect(parseSlots(o.rawSlotText ?? "").slots.length).toBeGreaterThan(0);
    }
  });

  it("修課人數：系上課表（115-2）完全未知；課程查詢（115-1）只有上限，已選人數仍未知", () => {
    expect(offeringsFor(115, 2, "fju").every((o) => o.capacity === undefined)).toBe(true);
    const t1 = offeringsFor(115, 1, "fju");
    expect(t1.every((o) => (o.capacity ?? 0) > 0 && o.enrolled === undefined)).toBe(true);
    // 未知不是 0：不能當額滿排除
    expect(t1.every((o) => remainingSeats(o) === null)).toBe(true);
  });

  it("同一門課分兩班：同課號、不同時段", () => {
    const calc = offeringsFor(115, 2, "fju").filter((o) => o.code === "02390");
    expect(calc).toHaveLength(2);
    expect(calc[0]!.rawSlotText).not.toBe(calc[1]!.rawSlotText);
  });

  it("115-1 課程查詢：通識記下領域、外國語文算基本能力、系上選修算系專選", () => {
    const t1 = offeringsFor(115, 1, "fju");
    const domains = new Set(t1.filter((o) => o.category.includes("general")).map((o) => o.generalDomain));
    expect([...domains].sort()).toEqual(["人文與藝術", "永續素養", "社會科學", "自然與科技"]);
    expect(t1.find((o) => o.name === "外國語文(中級英文)")?.category).toEqual(["basic-skills"]);
    expect(t1.find((o) => o.code === "19664")?.category).toContain("major-elective");
  });

  it("官方資料裡 19664 是「組織學習與社會探究」—— 規劃表把同一個課號也印給了資訊系統專案管理（校對清單 B1）", () => {
    expect(offeringsFor(115, 1, "fju").find((o) => o.code === "19664")?.name).toBe("組織學習與社會探究");
  });

  it("用課號查詢可以跨校：各校課號格式不重疊", () => {
    const codes = activeCourseCodes();
    expect(codes.has("02390")).toBe(true);
    expect(codes.has("IM4045")).toBe(true);
  });
});

describe("課程資訊只查自己學校", () => {
  it("示範學生問輔大才有的課：查不到，而不是回答別校的時段", () => {
    const r = answerCourseInfo("C++程式設計", "115-2");
    expect(r.kind).not.toBe("決定");
  });

  it("輔大學生問同一門課：查得到", () => {
    const r = answerCourseInfo("C++程式設計", "115-2", "fju");
    expect(r.kind).toBe("決定");
  });
});

describe("agent 的課程搜尋", () => {
  it("下學期是第 2 學期時，搜的是第 2 學期 —— 原本寫死成 1", async () => {
    const { runAudit } = await import("@/lib/agent/runner");
    const run = await runAudit({ providerKind: "mock", fixture: "demo", currentTerm: "115-1" });
    const call = run.trace.steps.flatMap((s) => s.toolCalls).find((c) => c.name === "course.search");
    expect(call, "應該有呼叫 course.search").toBeDefined();
    expect((call!.input as { year: number; term: number }).term).toBe(2);
    expect((call!.input as { year: number; term: number }).year).toBe(115);
  });
});
