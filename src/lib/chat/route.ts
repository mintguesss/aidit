import type { AuditResult, ExclusionReason, Plan, SolveResult, StudentRecord } from "@/lib/types";
import type { RulePack } from "@/lib/rules/schema";
import { simulate } from "@/lib/whatif/simulate";
import type { LlmBudget } from "@/lib/llm/client";
import {
  alreadyClarified,
  parseAskIntent,
  parsePlanIntent,
  type AskIntentResult,
  type PlanIntentResult,
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
  plan?: PlanTurnOutcome & { constraintSet: ConstraintSet };
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

  const intent = await parsePlanIntent(messages, budget);
  const tools = ["chat.intent"];

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

  const applied = applyParams(ctx.constraints, ctx.originalConstraints, intent.params, intent.reason);
  const solveCtx = buildContext(ctx.audit, ctx.record, ctx.pack, applied.next);
  // 「改了什麼」只能由實際生效的差異產生，不採用模型自述的 reason（見 describeDelta）
  const changed = intent.params.reset
    ? ["重設為個人資料的原始設定"]
    : describeDelta(ctx.constraints, applied.next);
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
      plan: { ...outcome, constraintSet: applied.next },
    };
  }

  return {
    reply: planReply(outcome),
    tools,
    intent: intent.intent,
    clarifying: false,
    plan: { ...outcome, constraintSet: applied.next },
  };
}

/** §1.3 每輪回報三件事：改了什麼條件、課表差異、代價 */
function planReply(o: PlanTurnOutcome): Reply {
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
  if (o.changed.length === 0) {
    return {
      kind: "決定",
      headline: "條件沒有變動，課表維持原樣。",
      detail: [
        "你說的條件與目前設定相同，所以沒有東西需要重算。",
        `目前條件：${o.constraints.join("・")}`,
        "想換個方向的話，可以改講堂數、星期或某一門課。",
      ].join("\n"),
      citations: [],
    };
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

  const intent = await parseAskIntent(messages, budget);
  const tools = ["chat.intent"];

  const guard = guardCommon(intent, messages);
  if (guard) return { reply: guard.reply, tools, intent: guard.intent, clarifying: guard.clarifying };

  if (intent.kind !== "intent") {
    return { reply: outOfScope("這不在系統能力範圍內。", "請洽系辦公室。"), tools, intent: "out-of-scope", clarifying: false };
  }

  const p = intent.params;
  switch (intent.intent) {
    case "personal-audit":
      tools.push("credit.audit");
      return { reply: answerPersonalAudit(ctx.audit, p.category), tools, intent: intent.intent, clarifying: false };

    case "regulation":
      tools.push("rule.lookup");
      return {
        reply: answerRegulation(p.topic ?? p.raw, ctx.pack, ctx.audit),
        tools,
        intent: intent.intent,
        clarifying: false,
      };

    case "course-info":
      tools.push("course.search");
      return {
        reply: answerCourseInfo(p.course ?? p.raw, ctx.audit.nextTerm),
        tools,
        intent: intent.intent,
        clarifying: false,
      };

    case "procedure":
      tools.push("procedure.lookup");
      return {
        reply: answerProcedure(p.procedure ?? p.raw),
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
