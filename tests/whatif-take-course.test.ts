import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { auditCredits } from "@/lib/audit/engine";
import { zRulePack } from "@/lib/rules/schema";
import { fixture } from "@/lib/providers/fixtures";
import { ruleConflict, ruleReconcile, withAnnouncedEffects } from "@/lib/agent/tools";
import { LlmBudget } from "@/lib/llm/client";
import { simulate } from "@/lib/whatif/simulate";
import { parseIntent } from "@/lib/whatif/intent";

/** 情境試算「如果我修了某門課」：大三結束的輔大學生，下學期 114-1 */

const base = zRulePack.parse({ ...JSON.parse(readFileSync("tests/fixtures/rulepacks/fju-im-111.draft.json", "utf8")), provenance: "approved", approvedBy: "t" });
const rec = fixture("fju-im-111-year3").record;

async function setup() {
  const outcomes = await Promise.all(ruleConflict(base).map((c) => ruleReconcile(c, rec.student, new LlmBudget())));
  const pack = withAnnouncedEffects(base, outcomes);
  const audit = auditCredits({ record: rec, pack, traceId: "t", currentTerm: "113-2", nextTerm: "114-1" });
  return { pack, audit };
}

describe("如果我修了某門課", () => {
  it.each([
    ["如果我修生死學會怎樣", "生死學"],
    ["下學期選財務管理算哪一類", "財務管理"],
  ])("「%s」解析成 take-course", async (said, course) => {
    const r = await parseIntent(said, { nextTerm: "114-1", unmetCourses: [] }, new LlmBudget());
    expect(r).toMatchObject({ kind: "scenario", scenario: { type: "take-course", course } });
  });

  it("停修仍然是停修，不會被當成修課", async () => {
    const r = await parseIntent("如果我停修財務管理會怎樣", { nextTerm: "114-1", unmetCourses: [] }, new LlmBudget());
    expect(r).toMatchObject({ kind: "scenario", scenario: { type: "withdraw-course" } });
  });

  it("永續素養領域的課（生死學）：採計方式要人工確認，指向全人教育課程中心", async () => {
    const { pack, audit } = await setup();
    const r = simulate({ scenario: { type: "take-course", course: "生死學" }, audit, record: rec, pack });
    expect(r.level).toBe("conditional");
    expect(r.headline).toContain("人工確認");
    expect(r.alternatives.join("")).toContain("全人教育課程中心");
    expect(r.citations.some((c) => c.quote?.includes("永續多元學群"))).toBe(true);
  });

  it("一般的課：說算進哪一類", async () => {
    const { pack, audit } = await setup();
    const r = simulate({ scenario: { type: "take-course", course: "財務管理" }, audit, record: rec, pack });
    expect(r.detail).toMatch(/會算進「.+」|沒有可以算進的類別/);
  });

  it("找不到的課明講", async () => {
    const { pack, audit } = await setup();
    const r = simulate({ scenario: { type: "take-course", course: "量子糾纏導論" }, audit, record: rec, pack });
    expect(r.headline).toBe("開課資料中找不到這門課");
  });
});
