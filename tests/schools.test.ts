import { describe, it, expect } from "vitest";
import { allOfferings, offeringsFor, activeCourseCodes } from "@/lib/offerings";
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

  it("輔大的時段全部解析得了（輔大節次代號）", () => {
    for (const o of allOfferings("fju")) {
      expect(o.slotsUnknown, `${o.name} ${o.rawSlotText}`).toBe(false);
      expect(parseSlots(o.rawSlotText ?? "").slots.length).toBeGreaterThan(0);
    }
  });

  it("輔大的修課人數未知，不是 0", () => {
    expect(allOfferings("fju").every((o) => o.capacity === undefined)).toBe(true);
  });

  it("同一門課分兩班：同課號、不同時段", () => {
    const calc = allOfferings("fju").filter((o) => o.code === "02390");
    expect(calc).toHaveLength(2);
    expect(calc[0]!.rawSlotText).not.toBe(calc[1]!.rawSlotText);
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
