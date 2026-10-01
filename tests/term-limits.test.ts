import { describe, it, expect } from "vitest";
import { termLimitsFor } from "@/lib/rules/term-limits";
import { zRulePack } from "@/lib/rules/schema";
import { loadRulePacks } from "@/lib/rules/loader";

/**
 * 修課學分上下限依學年（輔大選課辦法第十一條）：
 * 一至三年級下限 12、第四學年下限 9；上限 25，應屆畢業生得超修至 32。
 */

const cite = { docId: "d", locator: "第十一條", quote: "原文" };
const pack = zRulePack.parse({
  id: "t", dept: "X", admissionYear: 112, program: "day", version: "0", approvedAt: "2026-10-01",
  provenance: "synthetic", minCredits: 10, college: "C",
  documents: [{ id: "d", title: "選課辦法" }],
  categories: [{ id: "a", name: "a", shortName: "a", credits: 10, order: 1, match: { type: "anyPassed" }, citation: cite }],
  overflowPolicy: {},
  termLimits: { maxCredits: 25, minCredits: 12, byStudyYear: [{ fromYear: 4, minCredits: 9, maxCredits: 32 }], citations: [cite] },
});
const s112 = { admissionYear: 112 };

describe("依學年的修課學分上下限", () => {
  it("一至三年級用基本值", () => {
    expect(termLimitsFor(pack, s112, "112-1")).toEqual({ maxCredits: 25, minCredits: 12 });
    expect(termLimitsFor(pack, s112, "114-2")).toEqual({ maxCredits: 25, minCredits: 12 });
  });

  it("第四學年起套用調整：下限 9、上限 32", () => {
    expect(termLimitsFor(pack, s112, "115-1")).toEqual({ maxCredits: 32, minCredits: 9 });
  });

  it("用排課那個學期的學年算，不是現在的學年：大三下替大四上排課要用大四的", () => {
    // 現在是 114-2（大三），排的是 115-1（大四）
    expect(termLimitsFor(pack, s112, "115-1").minCredits).toBe(9);
  });

  it("延畢生（第五學年）沿用最後一條調整", () => {
    expect(termLimitsFor(pack, s112, "116-1")).toEqual({ maxCredits: 32, minCredits: 9 });
  });

  it("學期代號看不懂就回基本值，不猜", () => {
    expect(termLimitsFor(pack, s112, "下學期")).toEqual({ maxCredits: 25, minCredits: 12 });
  });

  it("沒有依學年調整的規則包，行為與以前完全相同", () => {
    const synthetic = loadRulePacks().find((p) => p.id === "im-111")!;
    expect(synthetic.termLimits.byStudyYear).toEqual([]);
    expect(termLimitsFor(synthetic, { admissionYear: 111 }, "115-1")).toEqual({
      maxCredits: synthetic.termLimits.maxCredits,
      minCredits: synthetic.termLimits.minCredits,
    });
  });
});

describe("學校", () => {
  it("同系所、同學年、同學制，不同學校不會對到同一份規則包", async () => {
    const { resolveRulePack } = await import("@/lib/rules/loader");
    const base = { id: "S-T", dept: "IM", admissionYear: 111, actualAdmissionYear: 111,
      status: "enrolled" as const, program: "day" as const };
    // 沒填學校＝合成資料
    const demo = resolveRulePack(base);
    expect(demo.ok && demo.pack.id).toBe("im-111");
    // 輔大的規則包還在草稿，不會被載入 —— 重點是不能退而求其次拿到合成的 im-111
    const fju = resolveRulePack({ ...base, school: "fju" });
    expect(fju.ok).toBe(false);
  });
});
