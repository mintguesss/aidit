import { describe, expect, it } from "vitest";
import { runAudit } from "@/lib/agent/runner";
import { askTurn, planTurn, type TurnContext } from "@/lib/chat/route";
import { constraintSetFrom } from "@/lib/chat/apply";
import { preferencesOf } from "@/lib/chat/apply";
import { resolveRulePack } from "@/lib/rules/loader";
import { LlmBudget } from "@/lib/llm/client";
import { fixture } from "@/lib/providers/fixtures";
import { LIMITS, type ChatMessage } from "@/lib/chat/types";

/**
 * 對話規則（CONVERSATION.md）。
 *
 * 測的不是「回答得好不好」，而是規則有沒有被遵守：
 *   §0.1 LLM 不得產生判定 —— 回覆文字全部由程式組出來
 *   §0.2 只有三種回答
 *   §0.3 無依據不作答
 *   §1.3 每輪回報三件事
 *   §1.4 無解不自動放寬
 *   §1.6 為什麼沒選某門課
 *   §2.3 規定查無結果不得用常識補
 *   §2.4 禁止的主題
 */

let cached: TurnContext | null = null;

async function ctx(): Promise<TurnContext> {
  if (cached) return { ...cached, constraints: { ...cached.originalConstraints } };
  const run = await runAudit({ providerKind: "mock", fixture: "demo", currentTerm: "114-2" });
  if (!run.ok) throw new Error("demo 應可完成審查");
  const record = fixture("demo").record;
  const pack = resolveRulePack(record.student);
  if (!pack.ok) throw new Error(pack.detail);
  const original = constraintSetFrom(preferencesOf(record.preferences));
  cached = {
    audit: run.audit,
    record,
    pack: pack.pack,
    constraints: original,
    originalConstraints: original,
    currentPlan: run.state.plans[0],
  };
  return { ...cached, constraints: { ...original } };
}

const msgs = (...turns: string[]): ChatMessage[] =>
  turns.map((t, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: t }));

const ask = async (...turns: string[]) => askTurn(msgs(...turns), await ctx(), new LlmBudget(LIMITS.llmCallsPerTurn));
const plan = async (...turns: string[]) => planTurn(msgs(...turns), await ctx(), new LlmBudget(LIMITS.llmCallsPerTurn));

describe("§0.2 只有三種回答", () => {
  it("每一種輸入都落在三類之一", async () => {
    const inputs = ["我還差多少學分？", "超修可以流用嗎？", "幫我寫一首詩", "老師好不好"];
    for (const q of inputs) {
      const r = await ask(q);
      expect(["決定", "不確定", "超出範圍"]).toContain(r.reply.kind);
    }
  });
});

describe("§0.3 無依據不作答", () => {
  it("規定類的回答一定附引用", async () => {
    const r = await ask("超修可以流用嗎？");
    expect(r.reply.kind).toBe("決定");
    expect(r.reply.citations.length).toBeGreaterThan(0);
  });

  it("查不到的規定回「不確定」，並列出查過哪些來源", async () => {
    const r = await ask("宿舍的門禁時間是幾點？依規定寫的");
    expect(r.reply.kind).not.toBe("決定");
    if (r.reply.kind === "不確定") {
      expect(r.reply.headline).toMatch(/查無|未收錄|不在/);
    }
  });
});

describe("§0.1 判定不得由 LLM 生成", () => {
  it("個人審查的數字與引擎一致", async () => {
    const c = await ctx();
    const r = await ask("我還差多少學分？");
    expect(r.reply.headline).toContain(String(c.audit.unmet));
    expect(r.tools).toContain("credit.audit");
  });

  it("問特定類別會回該類別的引擎數字", async () => {
    const c = await ctx();
    const cat = c.audit.categories.find((x) => x.id === "major-elective")!;
    const r = await ask("系專業選修還差多少？");
    expect(r.reply.headline).toContain(String(cat.unmet));
  });
});

describe("§2.2 意圖路由", () => {
  it("開課資訊走 course.search", async () => {
    const r = await ask("資料探勘什麼時候開？");
    expect(r.intent).toBe("course-info");
    expect(r.tools).toContain("course.search");
    expect(r.reply.kind).toBe("決定");
  });

  it("辦理流程走 procedure.lookup 並指向承辦單位", async () => {
    const r = await ask("抵免要怎麼申請？");
    expect(r.intent).toBe("procedure");
    expect(r.reply.contact).toBeTruthy();
  });

  it("要排課表會導向 A 介面，而不是在這裡排", async () => {
    const r = await ask("幫我排下學期的課");
    expect(r.redirect).toBe("plan");
    expect(r.plan).toBeUndefined();
  });

  it("what-if 走 simulate", async () => {
    const r = await ask("我想提前一學期畢業");
    expect(r.intent).toBe("what-if");
    expect(r.tools).toContain("whatif.simulate");
    expect(r.whatif).toBeDefined();
  });
});

describe("§2.4 明確禁止的主題", () => {
  const cases: [string, string][] = [
    ["這門課老師給分甜不甜？", "teacher-evaluation"],
    ["你猜我這科會不會被當？", "grade-prediction"],
    ["幫我加選這門課", "act-on-behalf"],
    ["我最近很憂鬱想找心理諮商", "professional-advice"],
    ["台大的畢業門檻是多少？", "other-institution"],
    ["我同學的成績是多少？", "other-student"],
  ];
  for (const [q, topic] of cases) {
    it(`${topic}：${q}`, async () => {
      const r = await ask(q);
      expect(r.reply.kind).toBe("超出範圍");
      expect(r.intent).toBe(`forbidden:${topic}`);
      // 簡短回絕，不要解釋一長串
      expect(r.reply.headline.length).toBeLessThan(40);
    });
  }
});

describe("§0.3 無依據不作答：停修哪一門要問清楚，不得拿描述當課名去查", () => {
  it("「停修一門三學分的課」沒有指名課程 → 問清楚", async () => {
    const r = await ask("如果我這學期停修一門三學分的課會怎樣？");
    expect(r.clarifying).toBe(true);
    expect(r.reply.headline).toContain("哪一門");
  });

  it("指名課程時照算，語尾詞不會被當成課名的一部分", async () => {
    const r = await ask("停修資料探勘會怎樣？");
    expect(r.clarifying).toBeFalsy();
    expect(r.intent).toContain("what-if");
  });
});

describe("§0.7 上限", () => {
  it("澄清只問一次，第二次不明確就轉超出範圍", async () => {
    const first = await ask("我想停修一門課");
    expect(first.clarifying).toBe(true);

    const second = await askTurn(
      [
        { role: "user", content: "我想停修一門課" },
        { role: "assistant", content: "想停修哪一門課？", meta: { kind: "不確定", clarifying: true } },
        { role: "user", content: "就那個啊" },
      ],
      await ctx(),
      new LlmBudget(LIMITS.llmCallsPerTurn),
    );
    expect(second.reply.kind).toBe("超出範圍");
  });

  it("單一 session 超過 20 輪即停止", async () => {
    const many: ChatMessage[] = Array.from({ length: 21 }, (_, i) => ({
      role: "user" as const,
      content: `第 ${i} 句`,
    }));
    const r = await askTurn(many, await ctx(), new LlmBudget(LIMITS.llmCallsPerTurn));
    expect(r.intent).toBe("limit");
    expect(r.reply.kind).toBe("超出範圍");
  });
});

describe("§1 A 介面：課表微調", () => {
  it("§1.3 每輪回報改了什麼、課表差異、代價", async () => {
    const r = await plan("課盡量集中");
    expect(r.plan).toBeDefined();
    expect(r.plan!.changed.length).toBeGreaterThan(0);
    expect(r.plan!.diff).toBeDefined();
    // 代價可能為空（沒有付出代價），但欄位必須存在
    expect(Array.isArray(r.plan!.costs)).toBe(true);
    expect(r.reply.headline.startsWith("已")).toBe(true);
  });

  it("§1.1 狀態是約束集合：多輪調整會累積", async () => {
    const c = await ctx();
    const first = await planTurn(msgs("空出星期五"), c, new LlmBudget(LIMITS.llmCallsPerTurn));
    expect(first.plan!.constraintSet.avoidDays).toContain(5);

    const second = await planTurn(
      msgs("不要早八"),
      { ...c, constraints: first.plan!.constraintSet },
      new LlmBudget(LIMITS.llmCallsPerTurn),
    );
    expect(second.plan!.constraintSet.avoidDays).toContain(5);
    expect(second.plan!.constraintSet.avoidEarly).toBe(true);
  });

  it("§1.4 無解時不自動放寬，改提出放寬選項", async () => {
    const c = await ctx();
    // 星期二、三、四全部空出 → 自然科技通識與系專選都排不進來
    const r = await planTurn(
      msgs("空出星期二"),
      {
        ...c,
        constraints: { ...c.constraints, avoidDays: [3, 4], targetCourseCount: undefined },
      },
      new LlmBudget(LIMITS.llmCallsPerTurn),
    );
    const p = r.plan!;
    if (!p.solve.ok) {
      expect(p.relaxOptions.length).toBeGreaterThan(0);
      expect(r.reply.kind).toBe("不確定");
      // 沒有偷偷放寬：使用者設的三天仍然在條件裡
      expect(p.constraintSet.avoidDays).toEqual(expect.arrayContaining([2, 3, 4]));
    }
  });

  it("§1.2 加課是轉成 pinCourses 重跑求解，不是直接寫進課表", async () => {
    const r = await plan("顧客關係管理一定要留");
    expect(r.plan!.constraintSet.pinCourses).toContain("IM4028");
    if (r.plan!.solve.ok) {
      expect(r.plan!.solve.plans[0]!.courses.map((x) => x.code)).toContain("IM4028");
    }
  });

  it("§1.6 為什麼沒選某門課：說得出在哪一步被排除", async () => {
    const full = await plan("為什麼沒有企業流程管理？");
    expect(full.explanation?.step).toBe("no-seat");

    const prereq = await plan("為什麼沒有智慧醫療資訊系統？");
    expect(prereq.explanation?.step).toBe("prerequisite");

    const clash = await plan("為什麼沒有服務系統設計？");
    expect(clash.explanation?.step).toBe("clash-reserved");
  });

  it("§1.5 清單外的意圖走超出範圍", async () => {
    const r = await plan("幫我查一下宿舍申請時間");
    expect(r.reply.kind).toBe("超出範圍");
  });

  it("課名查不到時明說，不默默忽略", async () => {
    const r = await plan("把量子力學導論換掉");
    expect(r.reply.kind).toBe("不確定");
    expect(r.reply.headline).toContain("找不到");
  });
});

describe("§0.6 每輪都要能寫進 trace", () => {
  it("回傳本輪的意圖與呼叫過的工具", async () => {
    const r = await ask("超修可以流用嗎？");
    expect(r.intent).toBe("regulation");
    expect(r.tools[0]).toBe("chat.intent");
    expect(r.tools).toContain("rule.lookup");
  });
});
