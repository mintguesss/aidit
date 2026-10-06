import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { auditCredits } from "@/lib/audit/engine";
import { zRulePack } from "@/lib/rules/schema";
import { fixture } from "@/lib/providers/fixtures";
import { rulePlanIntent } from "@/lib/chat/intent";
import { applyParams, constraintSetFrom, preferencesOf } from "@/lib/chat/apply";
import { buildContext } from "@/lib/chat/plan-turn";
import { solve } from "@/lib/solver/schedule";
import { topicCodes, topicTerms } from "@/lib/chat/topics";
import { offeringsFor } from "@/lib/offerings";

/**
 * 課表微調：「我想修一堂 AI 相關的課」（G2）、「多選一堂兩學分的課」（G1）。
 * 用輔大大二結束的示範學生排 113-1，對話走離線規則（單元測試不連模型）。
 */

const pack = zRulePack.parse({ ...JSON.parse(readFileSync("docs/review/fju-im-111.draft.json", "utf8")), provenance: "approved", approvedBy: "t" });
const rec = fixture("fju-im-111-year2").record;
const audit = auditCredits({ record: rec, pack, traceId: "t", currentTerm: "112-2", nextTerm: "113-1" });
const original = constraintSetFrom(preferencesOf(rec.preferences));

function planFor(set: typeof original, keep?: string[]) {
  const r = solve({ ...buildContext(audit, rec, pack, set), keep });
  if (!r.ok) throw new Error("排不出課表");
  return r.plans[0]!;
}
const shown = planFor(original);
const shownCodes = shown.courses.map((c) => c.code);

function turn(said: string) {
  const intent = rulePlanIntent(said);
  if (intent.kind !== "intent") throw new Error(`規則沒解析出意圖：${intent.kind}`);
  const applied = applyParams(original, original, intent.params, intent.reason, said, shown.courses.length, "fju");
  return { intent, applied, plan: applied.unresolved.length ? null : planFor(applied.next, shownCodes) };
}

describe("主題對到的課", () => {
  it("AI 用同義詞找課名：機器學習、人工智慧、大語言模型…，不會中「智慧財產」", () => {
    const names = offeringsFor(113, 1, "fju").filter((o) => topicCodes([o], "AI").length > 0).map((o) => o.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => /AI|人工智慧|機器學習|深度學習|語言模型|生成式|電腦視覺|自然語言/i.test(n))).toBe(true);
    expect(topicTerms("程式設計")).toContain("Python");
    expect(topicTerms("區塊鏈")).toEqual(["區塊鏈"]);
  });
});

describe("我想修一堂 AI 相關的課（G2）", () => {
  const { intent, applied, plan } = turn("我想修一堂AI相關的課");

  it("規則解析出主題，不是去找課名叫「AI相關的課」的課", () => {
    expect(intent.params.addTopic).toBe("AI");
    expect(intent.params.pinCourses).toEqual([]);
    expect(applied.unresolved).toEqual([]);
  });

  it("課表多一門，而且是 AI 相關的；原本的課留著", () => {
    expect(plan!.courses.length).toBe(shown.courses.length + 1);
    const codes = applied.next.wantTopic!.codes;
    expect(plan!.courses.some((c) => codes.includes(c.code))).toBe(true);
    for (const code of shownCodes) expect(plan!.courses.map((c) => c.code)).toContain(code);
  });

  it("找不到這種主題的課：明講找不到", () => {
    expect(turn("我想修一堂量子力學相關的課").applied.unresolved).toEqual(["量子力學 相關的課"]);
  });
});

describe("多選一堂兩學分的課（G1）", () => {
  const { intent, applied, plan } = turn("多選一堂兩學分的課");

  it("解析成「多一堂」＋「新加的課 2 學分」，不是學期學分上限", () => {
    expect(intent.params.courseCountDelta).toBe(1);
    expect(intent.params.newCourseCredits).toBe(2);
    expect(intent.params.maxCredits).toBeNull();
    expect(applied.next.newCourseCredits).toBe(2);
  });

  it("新加的那一門是 2 學分", () => {
    const added = plan!.courses.filter((c) => !shownCodes.includes(c.code));
    expect(added.length).toBe(1);
    expect(added[0]!.credits).toBe(2);
  });
});
