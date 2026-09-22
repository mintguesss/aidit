import { describe, expect, it } from "vitest";
import { auditCredits, InvariantError } from "@/lib/audit/engine";
import { resolveRulePack, loadRulePacks } from "@/lib/rules/loader";
import { activeCourseCodes } from "@/lib/offerings";
import { FIXTURES } from "@/lib/providers/fixtures";
import { generatedCases } from "@/eval/golden/generated";

/**
 * 不變式（docs/SPEC.md §3）。先寫這個測試，再寫引擎。
 *
 *   countable + inProgress + unmet === minCredits
 *   totalEarned === countable + overflow
 *
 * 超修不得填補任何類別的 unmet —— 這是 UI 上「123 學分卻還不能畢業」的來源。
 */

const auditableFixtures = FIXTURES.filter(
  (f) => f.record.student.admissionYear === f.record.student.actualAdmissionYear,
);

describe("不變式", () => {
  for (const f of auditableFixtures) {
    it(`${f.id}：countable + inProgress + unmet === minCredits`, () => {
      const pack = resolveRulePack(f.record.student);
      expect(pack.ok).toBe(true);
      if (!pack.ok) return;

      const a = auditCredits({
        record: f.record,
        pack: pack.pack,
        traceId: `test-${f.id}`,
        currentTerm: "114-2",
        nextTerm: "115-1",
        activeCourseCodes: activeCourseCodes(),
      });

      expect(a.countable + a.inProgress + a.unmet).toBe(a.minCredits);
      expect(a.totalEarned).toBe(a.countable + a.overflow);
    });
  }

  for (const g of generatedCases()) {
    it(`${g.id}：不變式成立`, () => {
      const pack = resolveRulePack(g.record.student);
      if (!pack.ok) throw new Error(pack.detail);
      const a = auditCredits({
        record: g.record,
        pack: pack.pack,
        traceId: `test-${g.id}`,
        currentTerm: "114-2",
        nextTerm: "115-1",
        activeCourseCodes: activeCourseCodes(),
      });
      expect(a.countable + a.inProgress + a.unmet).toBe(a.minCredits);
      expect(a.totalEarned).toBe(a.countable + a.overflow);
    });
  }
});

describe("超修不得流用", () => {
  it("自由選修超修 12 學分不得補系專業選修的 9 學分缺口", () => {
    const f = FIXTURES.find((x) => x.id === "overflow-no-transfer")!;
    const pack = resolveRulePack(f.record.student);
    if (!pack.ok) throw new Error(pack.detail);
    const a = auditCredits({
      record: f.record,
      pack: pack.pack,
      traceId: "test-overflow",
      currentTerm: "114-2",
      nextTerm: "115-1",
      activeCourseCodes: activeCourseCodes(),
    });
    expect(a.totalEarned).toBe(131);
    expect(a.totalEarned).toBeGreaterThan(a.minCredits);
    expect(a.overflow).toBe(12);
    expect(a.unmet).toBe(9);
    expect(a.categories.find((c) => c.id === "major-elective")!.unmet).toBe(9);
  });
});

describe("不變式失敗時必須中止", () => {
  it("規則包類別學分加總與 minCredits 不符時，載入階段即拒絕", () => {
    // zRulePack.superRefine 會擋下這種規則包，因此不可能進到引擎
    const packs = loadRulePacks();
    for (const p of packs) {
      expect(p.categories.reduce((a, c) => a + c.credits, 0)).toBe(p.minCredits);
    }
  });

  it("InvariantError 帶有可供查核的數字", () => {
    const e = new InvariantError("test", { countable: 1, inProgress: 2, unmet: 3, minCredits: 7 });
    expect(e.detail.minCredits).toBe(7);
    expect(e.name).toBe("InvariantError");
  });
});
