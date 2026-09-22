import { describe, expect, it } from "vitest";
import { runAudit } from "@/lib/agent/runner";
import { auditCredits } from "@/lib/audit/engine";
import { resolveRulePack } from "@/lib/rules/loader";
import { activeCourseCodes } from "@/lib/offerings";
import { GOLDEN_CASES } from "@/eval/golden/cases";
import { generatedCases } from "@/eval/golden/generated";

/** golden set 回歸：正確率不得下降（docs/BACKEND.md §10 第 3 條） */

describe("golden set（人工標準答案）", () => {
  for (const c of GOLDEN_CASES) {
    it(`${c.fixture}：${c.tests}`, async () => {
      const run = await runAudit({ providerKind: "mock", fixture: c.fixture, currentTerm: "114-2" });

      if (c.expectAllHold) {
        expect(run.ok).toBe(false);
        if (!run.ok) expect(run.error.kind).toBe("all-hold");
        return;
      }

      expect(run.ok).toBe(true);
      if (!run.ok) return;
      const a = run.audit;
      const e = c.expect!;

      expect({
        totalEarned: a.totalEarned,
        countable: a.countable,
        inProgress: a.inProgress,
        unmet: a.unmet,
        overflow: a.overflow,
        holds: a.holds.length,
      }).toEqual({
        totalEarned: e.totalEarned,
        countable: e.countable,
        inProgress: e.inProgress,
        unmet: e.unmet,
        overflow: e.overflow,
        holds: e.holds,
      });

      for (const ce of e.categories) {
        const got = a.categories.find((x) => x.id === ce.id)!;
        expect({
          id: got.id,
          earned: got.earned,
          inProgress: got.inProgress,
          unmet: got.unmet,
          overflow: got.overflow,
          status: got.status,
        }).toEqual(ce);
      }
    });
  }
});

describe("golden set（程式生成，標準答案由獨立參考實作計算）", () => {
  for (const g of generatedCases()) {
    it(`${g.id}：${g.tests}`, () => {
      const pack = resolveRulePack(g.record.student);
      if (!pack.ok) throw new Error(pack.detail);
      const a = auditCredits({
        record: g.record,
        pack: pack.pack,
        traceId: `t-${g.id}`,
        currentTerm: "114-2",
        nextTerm: "115-1",
        activeCourseCodes: activeCourseCodes(),
      });
      expect({
        totalEarned: a.totalEarned,
        countable: a.countable,
        inProgress: a.inProgress,
        unmet: a.unmet,
        overflow: a.overflow,
      }).toEqual({
        totalEarned: g.expect.totalEarned,
        countable: g.expect.countable,
        inProgress: g.expect.inProgress,
        unmet: g.expect.unmet,
        overflow: g.expect.overflow,
      });
      for (const ce of g.expect.categories) {
        const got = a.categories.find((x) => x.id === ce.id)!;
        expect({
          id: got.id,
          earned: got.earned,
          inProgress: got.inProgress,
          unmet: got.unmet,
          overflow: got.overflow,
          status: got.status,
        }).toEqual(ce);
      }
    });
  }
});
