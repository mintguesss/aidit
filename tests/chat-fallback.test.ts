import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 模型的後援與安全網（route.ts planTurn）。
 *
 * 單元測試一律走離線替身，模型就等於規則，後援那條路徑走不到。
 * 這裡把 parsePlanIntent 換成回傳固定值，值直接取自 qwen3:14b 實測送出的參數，
 * 驗證規則如何補上模型漏掉的條件、擋下模型編出來的條件。
 */
vi.mock("@/lib/chat/intent", async (orig) => {
  const actual = await orig<typeof import("@/lib/chat/intent")>();
  return {
    ...actual,
    parsePlanIntent: vi.fn(actual.parsePlanIntent),
    parseAskIntent: vi.fn(actual.parseAskIntent),
  };
});

import { parseAskIntent, parsePlanIntent, type AskIntentResult, type PlanIntentResult, type PlanParams } from "@/lib/chat/intent";
import { askTurn, planTurn, spokenCategory, type TurnContext } from "@/lib/chat/route";
import { runAudit } from "@/lib/agent/runner";
import { constraintSetFrom, preferencesOf } from "@/lib/chat/apply";
import { resolveRulePack } from "@/lib/rules/loader";
import { LlmBudget } from "@/lib/llm/client";
import { fixture } from "@/lib/providers/fixtures";
import { LIMITS } from "@/lib/chat/types";

let base: TurnContext;
beforeAll(async () => {
  const run = await runAudit({ providerKind: "mock", fixture: "demo", currentTerm: "114-2" });
  if (!run.ok) throw new Error("demo 應可完成審查");
  const record = fixture("demo").record;
  const pack = resolveRulePack(record.student);
  if (!pack.ok) throw new Error(pack.detail);
  const original = constraintSetFrom(preferencesOf(record.preferences));
  base = { audit: run.audit, record, pack: pack.pack, constraints: original, originalConstraints: original, currentPlan: run.state.plans[0] };
});

const empty = (): PlanParams => ({
  avoidDays: [], allowDays: [], avoidEarly: null, avoidMorning: null, avoidDayParts: [],
  preferCompactDays: null, maxCredits: null, courseCountDelta: null, courseCountTarget: null,
  goal: null, goals: [], excludeCourses: [], pinCourses: [], reset: false,
});

/** 讓「模型」這一輪回傳指定結果，然後跑一輪 planTurn */
async function withModel(said: string, model: PlanIntentResult) {
  vi.mocked(parsePlanIntent).mockResolvedValueOnce(model);
  return planTurn([{ role: "user", content: said }], { ...base, constraints: { ...base.constraints } }, new LlmBudget(LIMITS.llmCallsPerTurn));
}

describe("後援：模型沒給出有效變更時，改用規則從原句抽", () => {
  it("「不要早上的課」模型只設了 avoidEarly（本來就開著）→ 規則補上不排早上", async () => {
    const r = await withModel("不要早上的課", { kind: "intent", intent: "adjust-time", reason: "", params: { ...empty(), avoidEarly: true } });
    expect(r.plan!.constraintSet.avoidPeriods).toHaveLength(5);
    expect(r.tools).toContain("rule.fallback");
    expect(r.reply.headline).toBe("已不排早上的課（第 1–4 節）。");
  });

  it("「我想輕鬆一點」模型什麼都沒填 → 規則補上輕量目標", async () => {
    const r = await withModel("我想輕鬆一點", { kind: "intent", intent: "adjust-load", reason: "", params: empty() });
    expect(r.plan!.constraintSet.goal).toBe("light");
    expect(r.tools).toContain("rule.fallback");
  });

  it("模型說超出範圍，但原句有明確條件 → 用規則的", async () => {
    const r = await withModel("空出星期五", { kind: "out-of-scope" });
    expect(r.plan!.constraintSet.avoidDays).toContain(5);
    expect(r.tools).toContain("rule.fallback");
  });

  it("模型已經有有效變更時，不動用規則", async () => {
    const r = await withModel("空出星期五", { kind: "intent", intent: "adjust-time", reason: "", params: { ...empty(), avoidDays: [5] } });
    expect(r.tools).not.toContain("rule.fallback");
  });
});

describe("模型編出來的時段要擋下", () => {
  it("「星期二跟星期四都不要排課」被填成二、四早上 → 擋下，改由規則空出整天", async () => {
    const r = await withModel("星期二跟星期四都不要排課", {
      kind: "intent", intent: "adjust-time", reason: "",
      params: { ...empty(), avoidDayParts: [{ day: 2, part: "morning" }, { day: 4, part: "morning" }] },
    });
    const set = r.plan!.constraintSet;
    expect(set.avoidPeriods).toEqual([]);
    expect(set.avoidDays).toEqual(expect.arrayContaining([2, 4]));
    expect(r.plan!.refusedParams!.some((x) => x.includes("星期二早上"))).toBe(true);
  });

  it("接在集中後面的「下午」被填成星期五下午 → 擋下（原句沒有星期五）", async () => {
    const r = await withModel("下午", {
      kind: "intent", intent: "adjust-time", reason: "",
      params: { ...empty(), avoidDayParts: [{ day: 5, part: "afternoon" }] },
    });
    expect(r.plan!.constraintSet.avoidPeriods.some((a) => a.day === 5 && a.periods.includes(5))).toBe(false);
    expect(r.reply.headline).not.toContain("星期五");
  });

  it("「禮拜一早上要打工」被填成星期一下午 → 擋下（原句說的是早上）", async () => {
    const r = await withModel("我禮拜一早上要打工", {
      kind: "intent", intent: "adjust-time", reason: "",
      params: { ...empty(), avoidDayParts: [{ day: 1, part: "afternoon" }] },
    });
    const set = r.plan!.constraintSet;
    expect(set.avoidPeriods.some((a) => a.day === 1 && a.periods.includes(5))).toBe(false);
    // 規則補上的是原句說的早上
    expect(set.avoidPeriods).toContainEqual({ day: 1, periods: [1, 2, 3, 4] });
  });
});

describe("安全網：規則說該擋就擋，但規則絕不推翻模型的拒絕", () => {
  it("「壓力好大睡不著」模型沒拒絕、反而改成輕量 → 規則擋下，轉介諮商", async () => {
    const r = await withModel("我最近壓力好大睡不著", {
      kind: "intent", intent: "change-goal", reason: "", params: { ...empty(), goal: "light" },
    });
    expect(r.intent).toBe("forbidden:professional-advice");
    expect(r.plan).toBeUndefined();
    expect(r.tools).toContain("rule.forbidden");
  });

  it("模型拒絕了，規則雖然抽得出條件也不推翻", async () => {
    const r = await withModel("空出星期五", { kind: "forbidden", topic: "other-student" });
    expect(r.intent).toBe("forbidden:other-student");
    expect(r.plan).toBeUndefined();
  });
});

describe("「沒變動」要分清楚原因，不得把沒聽懂說成已經套用", () => {
  it("抓到要求但已是現狀 → 說已經是目前的設定", async () => {
    const r = await withModel("不要早八", { kind: "intent", intent: "adjust-time", reason: "", params: { ...empty(), avoidEarly: true } });
    expect(r.reply.headline).toBe("條件沒有變動，課表維持原樣。");
    expect(r.reply.detail).toContain("已經是目前的設定");
  });

  it("什麼都沒抓到 → 直說沒抓到，不說與目前設定相同", async () => {
    const r = await withModel("隨便排一下", { kind: "intent", intent: "adjust-load", reason: "", params: empty() });
    expect(r.reply.kind).toBe("不確定");
    expect(r.reply.headline).toContain("沒抓到");
    expect(`${r.reply.headline}${r.reply.detail ?? ""}`).not.toContain("相同");
  });

  it("模型隨手填的 false 是雜訊，不算抓到要求", async () => {
    const r = await withModel("隨便排一下", {
      kind: "intent", intent: "adjust-time", reason: "",
      params: { ...empty(), avoidEarly: false, avoidMorning: false, preferCompactDays: false },
    });
    expect(r.reply.headline).toContain("沒抓到");
    expect(r.plan!.constraintSet.avoidEarly).toBe(true);
  });
});

describe("數值要對得上原句，增減要有增減的字", () => {
  it("「只想修三門」模型填成 +3（2→5）→ 擋下，由規則設成 3 堂", async () => {
    const r = await withModel("這學期只想修三門", {
      kind: "intent", intent: "adjust-load", reason: "", params: { ...empty(), courseCountDelta: 3 },
    });
    expect(r.plan!.constraintSet.targetCourseCount).toBe(3);
    expect(r.plan!.refusedParams!.some((x) => x.includes("增加 3 堂"))).toBe(true);
  });

  it("「只想修三門」模型填成指定 5 堂 → 值對不上，擋下", async () => {
    const r = await withModel("這學期只想修三門", {
      kind: "intent", intent: "adjust-load", reason: "", params: { ...empty(), courseCountTarget: 5 },
    });
    expect(r.plan!.constraintSet.targetCourseCount).toBe(3);
  });

  it("「少一堂課」方向相反（+1）→ 擋下", async () => {
    const r = await withModel("少一堂課", {
      kind: "intent", intent: "adjust-load", reason: "", params: { ...empty(), courseCountDelta: 1 },
    });
    expect(r.plan!.constraintSet.targetCourseCount).toBeLessThan(2);
  });

  it("「學分不要超過 15」模型填成 18 → 擋下，由規則設成 15", async () => {
    const r = await withModel("學分不要超過 15", {
      kind: "intent", intent: "adjust-load", reason: "", params: { ...empty(), maxCredits: 18 },
    });
    expect(r.plan!.constraintSet.maxCredits).toBe(15);
  });

  it("中文數字也要對得上：「十二學分以內」", async () => {
    const r = await withModel("十二學分以內就好", {
      kind: "intent", intent: "adjust-load", reason: "", params: { ...empty(), maxCredits: 12 },
    });
    expect(r.plan!.constraintSet.maxCredits).toBe(12);
    expect(r.tools).not.toContain("rule.fallback");
  });
});

describe("模型多問一輪時，原句夠明確就直接做", () => {
  it("「我不想上顧客關係管理」模型反問要換成什麼 → 直接排除", async () => {
    const r = await withModel("我不想上顧客關係管理", { kind: "clarify", question: "你想換掉顧客關係管理，要換成什麼課？" });
    expect(r.plan!.constraintSet.excludeCourses).toContain("IM4028");
    expect(r.tools).toContain("rule.fallback");
  });

  it("課名查不到時保留模型的反問", async () => {
    const r = await withModel("幫我加一堂AI相關的課程", { kind: "clarify", question: "想加哪一門？" });
    expect(r.clarifying).toBe(true);
    expect(r.reply.headline).toContain("想加哪一門");
  });
});

describe("安全網：兩邊都擋但理由不同時，用規則的理由（理由決定轉介到哪裡）", () => {
  it("「壓力好大睡不著」模型拒絕成「他人資料」→ 改成心理諮商，指向輔導單位", async () => {
    const r = await withModel("我最近壓力好大睡不著", { kind: "forbidden", topic: "other-student" });
    expect(r.intent).toBe("forbidden:professional-advice");
    expect(r.reply.contact).toContain("輔導");
    expect(r.tools).toContain("rule.forbidden");
  });

  it("理由一致時不多記一筆", async () => {
    const r = await withModel("我最近壓力好大睡不著", { kind: "forbidden", topic: "professional-advice" });
    expect(r.intent).toBe("forbidden:professional-advice");
    expect(r.tools).not.toContain("rule.forbidden");
  });
});

/** 讓「模型」這一輪回傳指定結果，然後跑一輪 askTurn */
async function askWithModel(said: string, model: AskIntentResult) {
  vi.mocked(parseAskIntent).mockResolvedValueOnce(model);
  return askTurn([{ role: "user", content: said }], { ...base, constraints: { ...base.constraints } }, new LlmBudget(LIMITS.llmCallsPerTurn));
}
const askParams = (raw: string, extra: object = {}) => ({ raw, ...extra });

describe("問答：試算情境以字面關鍵字為準", () => {
  it("「我想提前在 115-1 畢業」模型選成成績門檻 → 改用提前畢業試算", async () => {
    const r = await askWithModel("我想提前在 115-1 畢業", {
      kind: "intent", intent: "what-if",
      params: askParams("我想提前在 115-1 畢業", { scenario: { type: "grade-threshold", targetTerm: null, dept: null, program: null, code: null } }),
    });
    // 成績門檻試算的標題是「系統不預測成績…」，提前畢業試算不會是這句
    expect(r.whatif?.headline).not.toContain("不預測成績");
    expect(r.tools).toContain("rule.fallback");
    expect(r.tools).toContain("whatif.simulate");
  });

  it("「我想在 115-1 畢業，有可能嗎？」模型當成查進度 → 改走試算", async () => {
    const r = await askWithModel("我想在 115-1 畢業，有可能嗎？", {
      kind: "intent", intent: "personal-audit", params: askParams("我想在 115-1 畢業，有可能嗎？"),
    });
    expect(r.intent).toBe("what-if");
  });

  it("模型拒絕時，規則的試算不得推翻", async () => {
    const r = await askWithModel("我想提前在 115-1 畢業", { kind: "forbidden", topic: "grade-prediction" });
    expect(r.intent).toBe("forbidden:grade-prediction");
  });
});

describe("問答：查詢先用模型的關鍵詞，查不到再用原句", () => {
  it("「抵免要怎麼申請？」模型抽了查不到的關鍵詞 → 用原句查到", async () => {
    const r = await askWithModel("抵免要怎麼申請？", {
      kind: "intent", intent: "procedure", params: askParams("抵免要怎麼申請？", { procedure: "credit transfer" }),
    });
    expect(r.reply.kind).toBe("決定");
    expect(r.reply.headline).toContain("抵免");
  });
});

describe("問答：類別只要使用者說了其中一段就算", () => {
  it("說「通識」、模型補成正式名稱「通識涵養課程」→ 照用", () => {
    expect(spokenCategory("通識涵養課程", "通識還差多少")).toBe("通識涵養課程");
  });

  it("端到端：回答要針對通識，不是整體進度", async () => {
    const r = await askWithModel("通識還差多少", {
      kind: "intent", intent: "personal-audit", params: askParams("通識還差多少", { category: "通識涵養課程" }),
    });
    expect(r.reply.headline.startsWith("通識")).toBe(true);
  });

  it("模型編的代號仍然擋下", () => {
    expect(spokenCategory("personal-audit", "我還差幾學分畢業？")).toBeUndefined();
  });
});

describe("問答：模型的類別被擋下時，改用規則從原句抽到的類別", () => {
  it("「通識還差多少」模型把意圖名稱填進類別 → 仍然回答通識", async () => {
    const r = await askWithModel("通識還差多少", {
      kind: "intent", intent: "personal-audit", params: askParams("通識還差多少", { category: "personal-audit" }),
    });
    expect(r.reply.headline.startsWith("通識")).toBe(true);
    expect(r.reply.headline).not.toContain("personal-audit");
  });
});
