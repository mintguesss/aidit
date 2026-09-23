import type { AuditResult, ExclusionReason, Plan, SolveResult, StudentRecord } from "@/lib/types";
import type { RulePack } from "@/lib/rules/schema";
import { simulate } from "@/lib/whatif/simulate";
import { LlmBudgetExceeded, type LlmBudget } from "@/lib/llm/client";
import {
  alreadyClarified,
  lastUser,
  parseAskIntent,
  parsePlanIntent,
  ruleAskIntent,
  rulePlanIntent,
  type AskIntentResult,
  type PlanIntentResult,
  type PlanParams,
} from "./intent";
import { applyParams, describeDelta, describeSet } from "./apply";
import {
  answerCourseInfo,
  answerPersonalAudit,
  answerProcedure,
  answerRegulation,
  capabilityLimits,
} from "./capabilities";
import { clarify, forbidden, outOfScope, uncertain } from "./compose";
import { buildContext, explain, runPlanTurn, type PlanTurnOutcome } from "./plan-turn";
import type { ChatMessage, ConstraintSet, Reply } from "./types";
import { LIMITS } from "./types";

/**
 * 兩個介面的路由器。
 *
 * 共同流程：意圖解析（唯一的 LLM 步驟）→ 呼叫對應能力 → 依模板組出回覆。
 * LLM 不產生任何判定；回覆文字由 compose.ts 從引擎結果組出來（§0.1）。
 */

export type TurnContext = {
  audit: AuditResult;
  record: StudentRecord;
  pack: RulePack;
  /** 目前的約束集合（A 介面用；B 介面遇到 plan 意圖時導向 A） */
  constraints: ConstraintSet;
  originalConstraints: ConstraintSet;
  currentPlan?: Plan;
};

export type TurnResult = {
  reply: Reply;
  /** 本輪呼叫了哪些工具（§0.6 寫 trace 用） */
  tools: string[];
  intent: string;
  /** 是否在向使用者提問（§0.7 澄清只問一次） */
  clarifying: boolean;
  /** A 介面：課表更新 */
  plan?: PlanTurnOutcome & {
    constraintSet: ConstraintSet;
    /** 模型推測出來、但使用者沒說出口而被擋下的參數（§0.6 寫 trace） */
    refusedParams?: string[];
  };
  /** B 介面：試算結果 */
  whatif?: ReturnType<typeof simulate>;
  /** §1.6 為什麼沒選某門課 */
  explanation?: ExclusionReason;
  /** B 介面導向 A 介面 */
  redirect?: "plan";
};

const TURN_LIMIT_REPLY = (n: number) =>
  outOfScope(
    `這段對話已達 ${n} 輪的上限。`,
    "請重新開始一段對話；目前的條件設定不會消失。",
  );

// ============================================================ A 介面

export async function planTurn(
  messages: ChatMessage[],
  ctx: TurnContext,
  budget: LlmBudget,
): Promise<TurnResult> {
  if (countTurns(messages) > LIMITS.turnsPerSession) {
    return { reply: TURN_LIMIT_REPLY(LIMITS.turnsPerSession), tools: [], intent: "limit", clarifying: false };
  }

  const raw = lastUser(messages);
  const tools = ["chat.intent"];
  let intent = await orRules(parsePlanIntent(messages, budget), () => rulePlanIntent(raw), tools);

  // 規則式解析當安全網與後援（見 intent.ts 的 rulePlanIntent）。
  // 方向是固定的：規則可以多擋、更正拒絕的理由、補上模型漏掉的條件，
  // 但絕不把模型的拒絕變成放行。
  const changesOf = (p: PlanParams, next: ConstraintSet) =>
    p.reset ? ["重設為個人資料的原始設定"] : describeDelta(ctx.constraints, next);

  const rules = rulePlanIntent(raw);
  if (rules.kind === "forbidden") {
    // 模型沒擋就補擋；模型也擋了但理由不同，採用規則的理由 ——
    // 理由決定轉介到哪裡：說壓力大睡不著的學生該被指向輔導中心，
    // 不是被告知「只能存取你本人的修課紀錄」（實測 qwen3:14b 就這樣回過）
    if (intent.kind !== "forbidden" || intent.topic !== rules.topic) tools.push("rule.forbidden");
    intent = rules;
  } else if (intent.kind === "out-of-scope" && rules.kind === "intent") {
    intent = rules;
    tools.push("rule.fallback");
  } else if (intent.kind === "clarify" && rules.kind === "intent") {
    // 模型想反問，但原句已經說得夠明確：規則抽得出有效變更、課名也全都查得到，
    // 就不必多問一輪。實測模型對「我不想上顧客關係管理」反問「要換成什麼課？」。
    // 課名查不到（「幫我加一堂AI相關的課程」）時保留模型的反問，那比「找不到」好。
    const tried = applyParams(ctx.constraints, ctx.originalConstraints, rules.params, rules.reason, raw);
    if (tried.unresolved.length === 0 && changesOf(rules.params, tried.next).length > 0) {
      intent = rules;
      tools.push("rule.fallback");
    }
  }

  const guard = guardCommon(intent, messages);
  if (guard) return { reply: guard.reply, tools, intent: guard.intent, clarifying: guard.clarifying };

  if (intent.kind === "explain") {
    const solveCtx = buildContext(ctx.audit, ctx.record, ctx.pack, ctx.constraints);
    const ex = explain(intent.course, solveCtx, ctx.currentPlan);
    tools.push("schedule.explain");
    return {
      reply: {
        kind: ex.step === "not-offered" ? "不確定" : "決定",
        headline: `${ex.name}：${STEP_LABEL[ex.step]}`,
        detail: ex.detail,
        citations: [],
        searched: ex.step === "not-offered" ? [`${ctx.audit.nextTerm} 開課資料`] : undefined,
        contact: ex.step === "not-offered" ? "教務處課務組" : undefined,
      },
      tools,
      intent: "explain",
      clarifying: false,
      explanation: ex,
    };
  }

  if (intent.kind === "compare") {
    const solveCtx = buildContext(ctx.audit, ctx.record, ctx.pack, ctx.constraints);
    const outcome = runPlanTurn(solveCtx, ctx.constraints, ctx.currentPlan, ["（未變更條件）"]);
    tools.push("schedule.solve");
    const alt = outcome.solve.ok ? outcome.solve.plans.length : 0;
    return {
      reply: {
        kind: alt > 1 ? "決定" : "不確定",
        headline:
          alt > 1
            ? `在目前條件下另有 ${alt - 1} 組同樣可行的組合。`
            : "在目前條件下沒有其他同樣可行的組合。",
        detail:
          alt > 1
            ? "下方列出全部方案，差異在採計同一類別的不同課程。"
            : "要看到不同的組合，需要先放寬或改變某一項條件。",
        citations: [],
        searched: alt > 1 ? undefined : ["目前條件下的所有可行組合"],
        contact: alt > 1 ? undefined : "可直接在此輸入想調整的條件",
      },
      tools,
      intent: "compare",
      clarifying: false,
      plan: { ...outcome, constraintSet: ctx.constraints },
    };
  }

  // guardCommon 已處理完其餘分支，這裡只可能是 intent；加這行讓型別收斂
  if (intent.kind !== "intent") {
    return { reply: outOfScope("這不在系統能力範圍內。", "請洽系辦公室。"), tools, intent: "out-of-scope", clarifying: false };
  }

  let applied = applyParams(ctx.constraints, ctx.originalConstraints, intent.params, intent.reason, raw);
  // 「改了什麼」只能由實際生效的差異產生，不採用模型自述的 reason（見 describeDelta）
  let changed = changesOf(intent.params, applied.next);
  let requested = applied.requested;

  // 模型解析出意圖，卻沒有任何有效變更 —— 沒填、填錯被擋、或填成原本就是的值。
  // 規則能從原句抽出有效變更的話改用規則的；抽不出來就維持「條件沒有變動」照實講。
  if (changed.length === 0 && rules.kind === "intent" && rules !== intent) {
    const byRules = applyParams(ctx.constraints, ctx.originalConstraints, rules.params, rules.reason, raw);
    const ruleChanged = changesOf(rules.params, byRules.next);
    requested ||= byRules.requested;
    if (ruleChanged.length > 0) {
      applied = { ...byRules, refusedParams: [...applied.refusedParams, ...byRules.refusedParams] };
      changed = ruleChanged;
      intent = rules;
      tools.push("rule.fallback");
    }
  }

  const solveCtx = buildContext(ctx.audit, ctx.record, ctx.pack, applied.next);
  const outcome = runPlanTurn(solveCtx, applied.next, ctx.currentPlan, changed);
  tools.push("schedule.solve");

  if (applied.unresolved.length > 0) {
    return {
      reply: uncertain({
        headline: `開課資料中找不到「${applied.unresolved.join("」「")}」。`,
        detail: "請給我課號，或用完整課名再說一次。",
        searched: [`${ctx.audit.nextTerm} 開課資料`],
        contact: "教務處課務組",
      }),
      tools,
      intent: intent.intent,
      clarifying: true,
      plan: { ...outcome, constraintSet: applied.next, refusedParams: applied.refusedParams },
    };
  }

  return {
    reply: planReply(outcome, requested),
    tools,
    intent: intent.intent,
    clarifying: false,
    plan: { ...outcome, constraintSet: applied.next, refusedParams: applied.refusedParams },
  };
}

/**
 * §1.3 每輪回報三件事：改了什麼條件、課表差異、代價。
 * requested：這一輪有沒有抓到任何具體要求（見 ApplyResult.requested）。
 */
function planReply(o: PlanTurnOutcome, requested: boolean): Reply {
  if (!o.solve.ok) {
    return uncertain({
      headline: "在這些條件下找不到可行的組合。",
      detail: [
        o.solve.infeasibilities.map((i) => `${i.category}：${i.suggestion}`).join("\n"),
        o.relaxOptions.length > 0 ? `可以考慮：${o.relaxOptions.join("／")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      searched: [`目前條件下的所有可行組合`],
      contact: "要放寬哪一項由你決定，直接告訴我即可",
    });
  }

  // 條件實際上沒有變動時，絕不宣稱改了什麼。
  // 這一輪有沒有改由 describeDelta 依前後約束集合認定，不由模型的自述認定 ——
  // 「說有改但其實沒改」比「沒改」更糟，使用者會據此以為條件已經套用。
  //
  // 沒變動有兩種原因，要分開講：說成「與目前設定相同」只有在真的抓到了要求時才是實話。
  if (o.changed.length === 0 && requested) {
    return {
      kind: "決定",
      headline: "條件沒有變動，課表維持原樣。",
      detail: [
        "你說的條件已經是目前的設定，所以沒有東西需要重算。",
        `目前條件：${o.constraints.join("・")}`,
        "想換個方向的話，可以改講堂數、星期或某一門課。",
      ].join("\n"),
      citations: [],
    };
  }
  if (o.changed.length === 0) {
    return uncertain({
      headline: "這句話我沒抓到要改哪個條件，課表維持原樣。",
      detail: [
        "可以換個說法，例如「空出星期五」「不要早上的課」「只修三門」「把某某課換掉」。",
        `目前條件：${o.constraints.join("・")}`,
      ].join("\n"),
      searched: ["時段、堂數、學分、目標與課程這幾類可調整的條件"],
      contact: "直接說想改的條件即可",
    });
  }

  // 三件事由下方的結構化卡片完整呈現，泡泡裡只留一句結論 ——
  // 同一段文字講兩遍，第二遍就沒有人看了
  const diff = o.diff.unchanged
    ? "課表沒有變動。"
    : [
        o.diff.removed.length > 0 ? `移除 ${o.diff.removed.join("、")}` : "",
        o.diff.added.length > 0 ? `加入 ${o.diff.added.join("、")}` : "",
      ]
        .filter(Boolean)
        .join("；") + "。";

  return {
    kind: "決定",
    headline: `已${o.changed.join("、")}。`,
    detail: diff,
    citations: [],
  };
}

const STEP_LABEL: Record<ExclusionReason["step"], string> = {
  "not-offered": "查無開課資料",
  "category-satisfied": "採計類別已無未修學分",
  prerequisite: "先修科目未修畢",
  "no-seat": "修課餘額為 0",
  "clash-reserved": "與已登記時段衝突",
  "avoid-day": "落在你指定要空出的星期",
  "avoid-period": "落在你指定要空出的節次",
  "excluded-by-user": "你指定要排除",
  "not-chosen": "有資格但未被選入",
  chosen: "已經排在課表裡",
};

// ============================================================ B 介面

export async function askTurn(
  messages: ChatMessage[],
  ctx: TurnContext,
  budget: LlmBudget,
): Promise<TurnResult> {
  if (countTurns(messages) > LIMITS.turnsPerSession) {
    return { reply: TURN_LIMIT_REPLY(LIMITS.turnsPerSession), tools: [], intent: "limit", clarifying: false };
  }

  const tools = ["chat.intent"];
  let intent = await orRules(parseAskIntent(messages, budget), () => ruleAskIntent(lastUser(messages)), tools);

  // 與 planTurn 相同的安全網與後援：規則可以多擋、可以補上模型漏判的路由，
  // 但絕不推翻模型的拒絕
  const rules = ruleAskIntent(lastUser(messages));
  const ruleScenario = rules.kind === "intent" && rules.intent === "what-if" ? rules.params.scenario : null;
  const modelScenario = intent.kind === "intent" && intent.intent === "what-if" ? intent.params.scenario : null;
  if (rules.kind === "forbidden") {
    // 模型沒擋就補擋；模型也擋了但理由不同，採用規則的理由 ——
    // 理由決定轉介到哪裡：說壓力大睡不著的學生該被指向輔導中心，
    // 不是被告知「只能存取你本人的修課紀錄」（實測 qwen3:14b 就這樣回過）
    if (intent.kind !== "forbidden" || intent.topic !== rules.topic) tools.push("rule.forbidden");
    intent = rules;
  } else if (intent.kind === "out-of-scope" && rules.kind === "intent") {
    intent = rules;
    tools.push("rule.fallback");
  } else if (ruleScenario && intent.kind !== "forbidden" && modelScenario?.type !== ruleScenario.type) {
    // 試算情境的關鍵字（提前畢業、停修、轉系、雙主修、輔系…）是字面上明確的，
    // 規則比對到了就以規則的情境為準。實測模型把「我想提前在 115-1 畢業」選成成績門檻試算，
    // 把「我想在 115-1 畢業，有可能嗎？」當成查修業進度 —— 答了，但答的不是使用者問的。
    intent = rules;
    tools.push("rule.fallback");
  }

  const guard = guardCommon(intent, messages);
  if (guard) return { reply: guard.reply, tools, intent: guard.intent, clarifying: guard.clarifying };

  if (intent.kind !== "intent") {
    return { reply: outOfScope("這不在系統能力範圍內。", "請洽系辦公室。"), tools, intent: "out-of-scope", clarifying: false };
  }

  const p = intent.params;
  switch (intent.intent) {
    case "personal-audit":
      tools.push("credit.audit");
      // 類別必須是使用者自己說出口的。實測 qwen3:14b 對「我還差幾學分畢業？」
      // 把 schema 的意圖名稱 "personal-audit" 填進 category，程式拿去查類別、
      // 查不到，就把模型吐的字串原封不動顯示成「查無「personal-audit」這個類別」。
      // 原句裡找不到的類別一律視為模型自己編的，直接忽略，改答整體進度；
      // 使用者真的問了某個不存在的類別（例如「體育學分夠嗎」）仍會走「查無」。
      return {
        // 模型的類別被擋下時，改用規則從原句抽到的類別。實測 qwen3:14b 對「通識還差多少」
        // 三次都把意圖名稱 "personal-audit" 填進 category —— 擋下是對的，但擋下後
        // 不該退回整體進度，使用者明明說了「通識」。
        reply: answerPersonalAudit(
          ctx.audit,
          spokenCategory(p.category, p.raw) ??
            (rules.kind === "intent" && rules.intent === "personal-audit" ? rules.params.category : undefined),
        ),
        tools,
        intent: intent.intent,
        clarifying: false,
      };

    case "regulation":
      tools.push("rule.lookup");
      return {
        reply: lookup(p.topic, p.raw, (q) => answerRegulation(q, ctx.pack, ctx.audit)),
        tools,
        intent: intent.intent,
        clarifying: false,
      };

    case "course-info":
      tools.push("course.search");
      return {
        reply: lookup(p.course, p.raw, (q) => answerCourseInfo(q, ctx.audit.nextTerm)),
        tools,
        intent: intent.intent,
        clarifying: false,
      };

    case "procedure":
      tools.push("procedure.lookup");
      return {
        reply: lookup(p.procedure, p.raw, answerProcedure),
        tools,
        intent: intent.intent,
        clarifying: false,
      };

    case "what-if": {
      if (!p.scenario) {
        return { reply: clarify("想試算哪一種情境？"), tools, intent: intent.intent, clarifying: true };
      }
      tools.push("whatif.simulate");
      const scenario = toScenario(p.scenario);
      if (!scenario) {
        return { reply: clarify("這個情境缺少必要的參數，可以再說明一次嗎？"), tools, intent: intent.intent, clarifying: true };
      }
      const result = simulate({ scenario, audit: ctx.audit, record: ctx.record, pack: ctx.pack });
      return {
        reply: {
          kind: result.level === "infeasible" ? "不確定" : "決定",
          headline: result.headline,
          detail: result.detail,
          citations: result.citations,
          searched: result.level === "infeasible" ? ["規則包與開課資料"] : undefined,
          contact: result.level === "infeasible" ? "系辦公室課務承辦人" : undefined,
          uncountedHolds: result.uncountedHolds,
        },
        tools,
        intent: intent.intent,
        clarifying: false,
        whatif: result,
      };
    }

    case "plan":
      return {
        reply: {
          kind: "決定",
          headline: "排課請到「選課建議」頁進行。",
          detail:
            "那裡會依你的選課傾向排出課表，並可在課表下方逐輪調整條件，" +
            "每次調整都會告訴你改了什麼、課表差在哪、代價是什麼。",
          citations: [],
        },
        tools,
        intent: intent.intent,
        clarifying: false,
        redirect: "plan",
      };

    default:
      return {
        reply: outOfScope(
          "這不在系統能力範圍內。",
          capabilityLimits(ctx.record, ctx.pack)[0] ?? "請洽系辦公室或教務處註冊組。",
        ),
        tools,
        intent: "out-of-scope",
        clarifying: false,
      };
  }
}

// ============================================================ 共用

/** forbidden／clarify／out-of-scope 三種在兩個介面的處理完全相同 */
function guardCommon(
  intent: PlanIntentResult | AskIntentResult,
  messages: ChatMessage[],
): { reply: Reply; intent: string; clarifying: boolean } | null {
  if (intent.kind === "forbidden") {
    return { reply: forbidden(intent.topic), intent: `forbidden:${intent.topic}`, clarifying: false };
  }
  if (intent.kind === "out-of-scope") {
    return {
      reply: outOfScope("這不在系統能力範圍內。", "請洽系辦公室或教務處註冊組。"),
      intent: "out-of-scope",
      clarifying: false,
    };
  }
  if (intent.kind === "clarify") {
    // §0.7 澄清提問每個問題 ≤ 1 次，再不明確就轉「超出範圍」
    if (alreadyClarified(messages)) {
      return {
        reply: outOfScope(
          "仍然無法確定你要的是什麼，這一題就到這裡。",
          "換個說法重新問，或直接洽系辦公室課務承辦人。",
        ),
        intent: "out-of-scope",
        clarifying: false,
      };
    }
    return { reply: clarify(intent.question), intent: "clarify", clarifying: true };
  }
  return null;
}

function countTurns(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

type ScenarioParams = {
  type:
    | "early-graduation"
    | "withdraw-course"
    | "add-minor"
    | "double-major"
    | "add-cert-program"
    | "change-major"
    | "grade-threshold";
  targetTerm: string | null;
  dept: string | null;
  program: string | null;
  code: string | null;
};

function toScenario(s: ScenarioParams) {
  switch (s.type) {
    case "early-graduation":
      return { type: "early-graduation" as const, targetTerm: s.targetTerm ?? "" };
    case "add-minor":
      return s.dept ? { type: "add-minor" as const, dept: s.dept } : null;
    case "double-major":
      return s.dept ? { type: "double-major" as const, dept: s.dept } : null;
    case "change-major":
      return s.dept ? { type: "change-major" as const, dept: s.dept } : null;
    case "add-cert-program":
      return s.program ? { type: "add-cert-program" as const, program: s.program } : null;
    case "withdraw-course":
      return s.code ? { type: "withdraw-course" as const, code: s.code } : null;
    case "grade-threshold":
      return { type: "grade-threshold" as const, target: "成績門檻" };
  }
}

export { describeSet };
export type { SolveResult };

/**
 * 只接受使用者原句裡提到過的類別。
 *
 * 意圖解析會把使用者沒說的欄位填滿（見 apply.ts 的 RELAX_CUE 註解），
 * category 也不例外，而它的值會直接進到回覆文字裡，所以幻覺會被原樣顯示給使用者。
 *
 * 「提到過」是類別名稱裡至少有兩個連續字出現在原句，而不是整個名稱：
 * 使用者說「通識還差多少」，模型填正式名稱「通識涵養課程」是對的，
 * 要求整串出現會把這種正確的補全也擋掉（早期版本就是這樣，結果答成了整體進度）。
 * 模型編出來的 "personal-audit" 跟中文原句一個字都對不上，仍然會被擋下。
 */
export function spokenCategory(category: string | null | undefined, raw: string): string | undefined {
  if (!category) return undefined;
  const t = raw.replace(/\s/g, "");
  const c = category.replace(/\s/g, "");
  for (let i = 0; i + 2 <= c.length; i++) {
    if (t.includes(c.slice(i, i + 2))) return category;
  }
  return undefined;
}

/**
 * 模型呼叫失敗時退回規則式解析，而不是整輪回「這次沒能處理你的問題」。
 *
 * llm/client 的 structured() 驗證失敗會重試一次，仍失敗就拋錯，規格寫的是
 * 「由呼叫端降級」。實測家用主機上另一個程式佔用顯卡時，qwen3:14b 連續十個請求
 * 都卡滿 30 秒逾時 —— 規則明明就在旁邊答得出來，整個對話卻不能用。
 * 呼叫預算用完仍照常往外拋，由 API 回 429：那是這一輪問得太多，不是模型壞了。
 * 退回時在 tools 記一筆 rule.degraded，trace 看得出這一輪沒用到模型。
 */
async function orRules<T>(call: Promise<T>, rules: () => T, tools: string[]): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof LlmBudgetExceeded) throw err;
    tools.push("rule.degraded");
    return rules();
  }
}

/**
 * 先用模型抽的關鍵詞查，查不到再用使用者原句查。
 *
 * 模型的關鍵詞是為了涵蓋規則想不到的說法，不該反過來讓查得到的變查不到：
 * 實測 qwen3:14b 對「抵免要怎麼申請？」抽出的關鍵詞查無流程，原句一查就有。
 */
function lookup(keyword: string | undefined, raw: string, answer: (q: string) => Reply): Reply {
  const first = answer(keyword ?? raw);
  if (first.kind === "決定" || !keyword || keyword === raw) return first;
  const second = answer(raw);
  return second.kind === "決定" ? second : first;
}
