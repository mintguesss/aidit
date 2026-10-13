import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { auditCredits } from "@/lib/audit/engine";
import { zRulePack } from "@/lib/rules/schema";
import { fixture } from "@/lib/providers/fixtures";
import { isDropCategory, planTurn } from "@/lib/chat/route";
import { buildContext } from "@/lib/chat/plan-turn";
import { constraintSetFrom, preferencesOf } from "@/lib/chat/apply";
import { rulePlanIntent } from "@/lib/chat/intent";
import { solve } from "@/lib/solver/schedule";
import { LlmBudget } from "@/lib/llm/client";
import { LIMITS, type ChatMessage, type ConstraintSet } from "@/lib/chat/types";
import type { Plan } from "@/lib/types";

/**
 * 課表對話：換成、拿掉某一類、不要早八、換另一門（TODO G12）。
 *
 * 使用者實測回報：原本 4 堂，說「通識拿掉，換成一堂 AI 的課」，結果變 5 堂、多兩堂 AI、
 * 其中一堂早八，再說「不要早八」也沒用。規格逐條和使用者確認過：
 *   換成／改成：堂數不變；加／多一堂：+1
 *   沒被點名的課一律保留
 *   拿掉一堂某類：挑一門（早八、或那天只有它的優先）並說是哪一門；沒說幾門就先問
 *   這學期都不排某類：堂數不變，改排其他類別
 *   不要早八：只開早八的非必修課換掉，必修沒得換就留
 *
 * 用輔大大二結束的示範學生排 113-1，對話走離線規則（單元測試不連模型）。
 */

const pack = zRulePack.parse({ ...JSON.parse(readFileSync("tests/fixtures/rulepacks/fju-im-111.draft.json", "utf8")), provenance: "approved", approvedBy: "t" });
const rec = fixture("fju-im-111-year2").record;
const audit = auditCredits({ record: rec, pack, traceId: "t", currentTerm: "112-2", nextTerm: "113-1" });
const original = constraintSetFrom(preferencesOf(rec.preferences));
const first = solve(buildContext(audit, rec, pack, original));
const shown0 = first.ok ? first.plans[0]!.courses.map((c) => c.code) : [];
const isGeneral = (c: Plan["courses"][number]) => c.categoryLabel.includes("通識");

/** 依序說好幾句，每一句都以上一句的結果為基準（跟畫面上一樣） */
async function talk(...said: string[]) {
  const messages: ChatMessage[] = [];
  let constraints: ConstraintSet = original;
  let shown = shown0;
  let last: Awaited<ReturnType<typeof planTurn>> | undefined;
  for (const s of said) {
    messages.push({ role: "user", content: s });
    last = await planTurn(
      messages,
      { audit, record: rec, pack, constraints, originalConstraints: original, shownCodes: shown } as never,
      new LlmBudget(LIMITS.llmCallsPerTurn),
    );
    messages.push({ role: "assistant", content: last.reply.headline, meta: { kind: last.reply.kind, clarifying: last.clarifying } });
    if (last.plan?.constraintSet) constraints = last.plan.constraintSet;
    const p = last.plan?.solve.ok ? last.plan.solve.plans[0] : undefined;
    if (p) shown = p.courses.map((c) => c.code);
  }
  const plan = last!.plan?.solve.ok ? last!.plan.solve.plans[0] : undefined;
  return { r: last!, plan, codes: plan?.courses.map((c) => c.code) ?? [] };
}

describe("前提：示範學生的課表有兩門通識", () => {
  it("才測得到「拿掉一堂」要挑哪一門", () => {
    const p = first.ok ? first.plans[0]! : undefined;
    expect(p!.courses.filter(isGeneral).length).toBe(2);
  });
});

describe("把一堂通識換成 AI 的課", () => {
  it.each(["把一堂通識換成AI相關的課", "通識拿掉 換成一堂AI的課"])("「%s」：堂數不變、少一門通識、多一門 AI 課，其他課沒動", async (said) => {
    const { r, plan, codes } = await talk(said);
    expect(codes.length).toBe(shown0.length);
    const removed = shown0.filter((c) => !codes.includes(c));
    const added = codes.filter((c) => !shown0.includes(c));
    expect(removed.length).toBe(1);
    expect(added.length).toBe(1);
    expect(r.plan!.constraintSet.wantTopic!.codes).toContain(added[0]);
    expect(plan!.courses.filter(isGeneral).length).toBe(2); // 拿掉的通識由 AI 通識課補上
    expect(r.reply.headline).toMatch(/拿掉「通識涵養課程」的/);
    expect(r.reply.headline).not.toMatch(/期望 \d+ 堂/); // 堂數沒變，不說改了堂數
  });

  it("只說「加一堂 AI 相關的課」：+1 堂，原本的課全部保留", async () => {
    const { codes } = await talk("我想加一堂AI相關的課");
    expect(codes.length).toBe(shown0.length + 1);
    for (const c of shown0) expect(codes).toContain(c);
  });
});

describe("拿掉某一類", () => {
  it("沒說幾門、課表上有兩門：先問拿一門還是這學期都不排", async () => {
    const { r } = await talk("通識拿掉");
    expect(r.clarifying).toBe(true);
    expect(r.reply.headline).toContain("還是這學期都不排");
  });

  it("回「一門」：拿掉一門，而且不會自己再補一門通識回來", async () => {
    const { plan, codes } = await talk("通識拿掉", "一門");
    expect(codes.length).toBe(shown0.length - 1);
    expect(plan!.courses.filter(isGeneral).length).toBe(1);
    for (const c of codes) expect(shown0).toContain(c);
  });

  it("「換另一門」：剛拿掉的放回來，改拿同一類的另一門，堂數不變", async () => {
    const one = await talk("拿掉一堂通識");
    const two = await talk("拿掉一堂通識", "換另一門");
    const droppedFirst = shown0.find((c) => !one.codes.includes(c))!;
    const droppedNow = shown0.filter((c) => !two.codes.includes(c));
    expect(two.codes).toContain(droppedFirst);
    expect(droppedNow.length).toBe(1);
    expect(droppedNow[0]).not.toBe(droppedFirst);
    expect(two.r.reply.headline).toContain("放回");
  });

  it("「這學期都不排通識」：沒有通識的課，堂數不變（改排其他類別）", async () => {
    const { plan, codes } = await talk("這學期都不排通識");
    expect(plan!.courses.some(isGeneral)).toBe(false);
    expect(codes.length).toBe(shown0.length);
  });
});

describe("不要早八：有替代就換", () => {
  it("只開早八的通識（哲學概論）換成同類的別門，其他課不動", async () => {
    // 畫面上的課表：把一門通識換成只開早八的哲學概論
    const general = (first.ok ? first.plans[0]!.courses : []).filter(isGeneral).map((c) => c.code);
    const shown = [...shown0.filter((c) => c !== general[1]), "00006"];
    const r = await planTurn(
      [{ role: "user", content: "不要早八" }],
      { audit, record: rec, pack, constraints: original, originalConstraints: original, shownCodes: shown } as never,
      new LlmBudget(LIMITS.llmCallsPerTurn),
    );
    const plan = r.plan!.solve.ok ? r.plan!.solve.plans[0]! : undefined;
    const codes = plan!.courses.map((c) => c.code);
    expect(codes).not.toContain("00006");
    expect(codes.length).toBe(shown.length);
    for (const c of shown.filter((x) => x !== "00006")) expect(codes).toContain(c);
    expect(plan!.courses.filter(isGeneral).length).toBe(2);
  });
});

describe("改回去 vs 重來", () => {
  it("「改回去」不是重來：由畫面上的對話紀錄退一步（ChatPanel），規則不當成重設", () => {
    const undo = rulePlanIntent("改回去");
    expect(undo.kind === "intent" && undo.params.reset).toBeFalsy();
    const reset = rulePlanIntent("重來");
    expect(reset.kind === "intent" && reset.params.reset).toBe(true);
  });
});

describe("要拿掉的類別要對得上（isDropCategory）", () => {
  it.each([
    ["通識", "通識拿掉", true],
    ["通識涵養課程", "拿掉一堂通識", true],
    ["選修", "這學期不排選修", true],
    ["", "不要早上的課", false],
    ["早上的課", "不要早上的課", false],
    ["通識", "不要早上的課", false], // 原句沒說
    ["體育", "體育拿掉", false], // 規則包沒有這一類
  ] as const)("「%s」＋原句「%s」→ %s", (category, raw, want) => {
    expect(isDropCategory(category, raw, pack)).toBe(want);
  });
});

describe("有模型版實測找到的（2026-10-09）", () => {
  it("「我想多修一堂程式相關的課」：+1 堂，原本的課全部保留（主題課換一門不衝堂的，不擠掉生死學）", async () => {
    const { codes, r } = await talk("我想多修一堂程式相關的課");
    expect(codes.length).toBe(shown0.length + 1);
    for (const c of shown0) expect(codes).toContain(c);
    expect(codes.some((c) => r.plan!.constraintSet.wantTopic!.codes.includes(c))).toBe(true);
  });

  it("「這學期不想上通識課」：整類不排，不會多一句「找不到『通識課』」", async () => {
    const { r, plan } = await talk("這學期不想上通識課");
    expect(r.reply.headline).not.toContain("找不到");
    expect(plan!.courses.some(isGeneral)).toBe(false);
  });

  it("「我不想修人生哲學」：它是全人核心這學期唯一能補的課 → 不拿掉、說明原因，課表維持原樣", async () => {
    const { r, codes } = await talk("我不想修人生哲學");
    expect(r.reply.headline).toContain("做不到");
    expect(r.reply.detail).toContain("唯一能補的課");
    expect(codes).toEqual(expect.arrayContaining(shown0));
  });

  it("「課排下午」把人生哲學換到下午的班：要說換了班，不能說課表沒有變動", async () => {
    const { r } = await talk("我早上爬不起來，課排下午");
    expect(r.reply.detail).toContain("換班：人生哲學改到");
    expect(r.reply.detail).not.toContain("課表沒有變動");
  });

  it("「幫我排輕鬆一點」課表沒變：說明已經在學期學分下限", async () => {
    const { r } = await talk("幫我排輕鬆一點的課表");
    expect(r.reply.detail).toContain("學期學分下限");
  });
});
