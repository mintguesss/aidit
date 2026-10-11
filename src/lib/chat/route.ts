import type { AuditResult, ExclusionReason, Offering, Plan, SolveResult, StudentRecord } from "@/lib/types";
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
  DROP_ALL_CUE,
  type AskIntentResult,
  type PlanIntentResult,
  type PlanParams,
} from "./intent";
import { applyParams, describeDelta, describeSet, periodNamesFor } from "./apply";
import {
  answerCourseInfo,
  answerPersonalAudit,
  categoryFromText,
  subRuleNamed,
  answerProcedure,
  answerRegulation,
  capabilityLimits,
  mentionsGraduationCheck,
} from "./capabilities";
import { clarify, forbidden, outOfScope, uncertain } from "./compose";
import { buildContext, explain, runPlanTurn, type PlanTurnOutcome } from "./plan-turn";
import type { ChatMessage, ConstraintSet, Reply } from "./types";
import { LIMITS } from "./types";
import { schoolOf, withoutOwnSchool } from "@/lib/schools";
import { isEarlyMorning } from "@/lib/solver/slots";
import { slotTextOf } from "@/lib/solver/schedule";
import { offeringsFor } from "@/lib/offerings";

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
  /** 依個人資料求出的第一版課表 */
  currentPlan?: Plan;
  /**
   * 前端畫面上目前顯示的課號。有的話用它重建使用者眼前的課表（見 shownPlan）；
   * 沒有的話（第一輪、舊版前端）就以目前條件重算。
   */
  shownCodes?: string[];
  /** 畫面上每門課的時段（課號 → slotText）。同一門課有好幾班，重建時只用畫面上那一班 */
  shownSlots?: Record<string, string>;
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

  // 「要拿掉一門，還是這學期都不排？」之後的回答（「一門」「全部」）要接回上一句才看得懂（TODO G12）
  const raw = withDropAnswer(messages) ?? lastUser(messages);
  // 規則看的句子：學生自己學校的稱呼換成「本校」，「輔大」才不會被當成他校
  const forRules = withoutOwnSchool(raw, schoolOf(ctx.record.student));
  const tools = ["chat.intent"];
  let intent = await orRules(parsePlanIntent(messages, budget), () => rulePlanIntent(forRules), tools);

  // 使用者眼前的課表（見 shownPlan）。ctx.currentPlan 是依個人資料求的第一版，
  // 多輪之後就不是使用者看到的了 —— 拿它當「之前」，課表差異會一直跟第一版比，
  // 「多一堂／少一堂」也會從錯的地方加減。
  const shown = shownPlan(ctx);
  const shownCount = shown?.courses.length;

  // 規則式解析當安全網與後援（見 intent.ts 的 rulePlanIntent）。
  // 方向是固定的：規則可以多擋、更正拒絕的理由、補上模型漏掉的條件，
  // 但絕不把模型的拒絕變成放行。
  const changesOf = (p: PlanParams, next: ConstraintSet) =>
    p.reset ? ["重設為個人資料的原始設定"] : describeDelta(ctx.constraints, next, periodNamesFor(ctx.record.student.school));

  const rules = rulePlanIntent(forRules);
  intent = correctOtherInstitution(intent, rules, tools);
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
    const tried = applyParams(ctx.constraints, ctx.originalConstraints, rules.params, rules.reason, raw, shownCount, schoolOf(ctx.record.student));
    if (tried.unresolved.length === 0 && changesOf(rules.params, tried.next).length > 0) {
      intent = rules;
      tools.push("rule.fallback");
    }
  }

  const guard = guardCommon(intent, messages);
  if (guard) return { reply: guard.reply, tools, intent: guard.intent, clarifying: guard.clarifying };

  if (intent.kind === "explain") {
    const solveCtx = buildContext(ctx.audit, ctx.record, ctx.pack, ctx.constraints);
    const ex = explain(intent.course, solveCtx, shown);
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
    // 第一個方案要是畫面上那一份，後面才是「另外幾組」
    const solveCtx = { ...buildContext(ctx.audit, ctx.record, ctx.pack, ctx.constraints), keep: ctx.shownCodes };
    const outcome = runPlanTurn(solveCtx, ctx.constraints, shown, ["（未變更條件）"], periodNamesFor(ctx.record.student.school));
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

  // 模型留空的欄位，規則從原句抽得到就補上。實測 qwen3:14b 對「不要早上的課」
  // 只填 avoidEarly、avoidMorning 留空 —— 有生效的變更，下面「沒變更才改用規則」接不到，
  // 結果只排掉早八，使用者要的整個早上沒做到。只補留空的，模型填了的不覆蓋；
  // 規則抽到的都是原句字面上的條件，補上不會多做使用者沒說的事
  if (rules.kind === "intent" && rules !== intent) {
    const merged = fillEmpty(intent.params, rules.params);
    if (merged !== intent.params) {
      intent = { ...intent, params: merged };
      tools.push("rule.merge");
    }
  }

  // 模型有時把 dropCategory 填成空字串或「早上的課」：空字串會比對到每一類，
  // 變成「課表上有 5 門…要拿掉一門，還是這學期都不排「」？」。對不上規則包的類別就當沒說
  if (intent.params.dropCategory && !isDropCategory(intent.params.dropCategory.category, raw, ctx.pack)) {
    intent = { ...intent, params: { ...intent.params, dropCategory: null } };
    tools.push("rule.drop-category-ignored");
  }
  if (intent.params.dropCategory) {
    const d = intent.params.dropCategory;
    const t = raw.replace(/\s/g, "");
    // 數量也要原句有：實測 qwen3:14b 對「通識拿掉」填 count="all"，沒問就整類不排了
    const count =
      d.count === "all" ? (DROP_ALL_CUE.test(t) ? "all" : null)
      : d.count !== null && !/[\d一二兩三四五六][堂門個]/.test(t) && !(intent.params.replace && /換成|改成/.test(t)) ? null
      : d.count;
    // 模型常把類別也塞進要排除的課名（「通識課」），那不是課名，查不到只會多一句「找不到」
    const word = d.category.replace(/課程?$/, "");
    const excludeCourses = intent.params.excludeCourses.filter((x) => !new RegExp(`^${word}(?:的)?(?:課程?|類)?$`).test(x.replace(/\s/g, "")));
    intent = { ...intent, params: { ...intent.params, dropCategory: { ...d, count }, excludeCourses } };
  }
  // 「拿掉一堂通識」「這學期不排通識」「換另一門」（TODO G12）：要看眼前課表上哪幾門屬於那一類
  const drop = resolveDrop(intent.params, raw, shown, ctx);
  if (drop.reply) return { reply: drop.reply, tools, intent: intent.intent, clarifying: true };
  if (drop.excludeCodes.length > 0 || drop.unexclude.length > 0) {
    intent = { ...intent, params: { ...intent.params, excludeCourses: [...intent.params.excludeCourses, ...drop.excludeCodes] } };
  }

  let applied = applyParams(ctx.constraints, ctx.originalConstraints, intent.params, intent.reason, raw, shownCount, schoolOf(ctx.record.student));
  if (drop.applies) {
    const next: ConstraintSet = {
      ...applied.next,
      excludeCourses: applied.next.excludeCourses.filter((c) => !drop.unexclude.includes(c)),
      ...(drop.skip.length > 0
        ? { skipCategories: [...(applied.next.skipCategories ?? []).filter((x) => !drop.skip.some((y) => y.id === x.id)), ...drop.skip] }
        : {}),
      ...(drop.lastDrop ? { lastDrop: drop.lastDrop } : {}),
    };
    // 堂數：拿掉幾門、同一句又加了幾門（「換成一堂 AI 的課」），而且是上限 —— 不自己補回來。
    // 「這學期都不排通識」不改堂數：通識的位置改排其他類別的課
    if (shownCount !== undefined && drop.skip.length === 0) {
      // 加回來的：同一句要加的主題課、指定的課，以及「換另一門」放回來的那門
      const additions = (intent.params.addTopic ? 1 : 0) + intent.params.pinCourses.length + drop.unexclude.length;
      next.targetCourseCount = Math.max(0, shownCount - drop.removedCount + additions);
      next.maxCourseCount = next.targetCourseCount;
    }
    applied = { ...applied, next, requested: true };
  }
  // 「改了什麼」只能由實際生效的差異產生，不採用模型自述的 reason（見 describeDelta）
  // 堂數沒變（換成、整類不排）就不說「已改為期望 N 堂課」，那只會讓人以為多了或少了一堂
  const relabel = (lines: string[]) =>
    drop.relabel(lines).filter((l) => !(drop.applies && l === `改為期望 ${shownCount} 堂課`));
  let changed = relabel(changesOf(intent.params, applied.next));
  let requested = applied.requested;

  // 模型解析出意圖，卻沒有任何有效變更 —— 沒填、填錯被擋、或填成原本就是的值。
  // 規則能從原句抽出有效變更的話改用規則的；抽不出來就維持「條件沒有變動」照實講。
  if (changed.length === 0 && rules.kind === "intent" && rules !== intent) {
    const byRules = applyParams(ctx.constraints, ctx.originalConstraints, rules.params, rules.reason, raw, shownCount, schoolOf(ctx.record.student));
    const ruleChanged = changesOf(rules.params, byRules.next);
    requested ||= byRules.requested;
    if (ruleChanged.length > 0) {
      applied = { ...byRules, refusedParams: [...applied.refusedParams, ...byRules.refusedParams] };
      changed = ruleChanged;
      intent = rules;
      tools.push("rule.fallback");
    }
  }

  // 眼前課表上沒被點名的課一律保留（TODO G12）：跟學年課下半同一級，排課時一定要接上。
  // 例外：重來、換修課目標（本來就要重排）；拿掉的、整類不排的；
  // 「不要早八」而那門課只有早八的班、又不是必修 —— 有替代就換
  const solveFor = (set: ConstraintSet) => {
    const base = buildContext(ctx.audit, ctx.record, ctx.pack, set);
    const strict = intent.params.reset || intent.intent === "change-goal" ? [] : [...strictKeep(shown, set, base.offerings), ...drop.unexclude];
    return {
      ...base,
      keep: shown?.courses.map((c) => c.code),
      continueCodes: new Set([...(base.continueCodes ?? []), ...strict]),
    };
  };
  let outcome = runPlanTurn(solveFor(applied.next), applied.next, shown, changed, periodNamesFor(ctx.record.student.school));
  tools.push("schedule.solve");

  // 這一輪要的條件做不到 → 不套用，照實說做不到、最多能到哪裡。
  // 記下一個做不到的條件、再說「已改為期望 1 堂課」而課表紋風不動，使用者只會困惑；
  // 條件做得到的部分照做（盡量改），做不到的部分退回原狀並說明。
  const params = intent.params;
  const countAsked = params.courseCountTarget !== null || (params.courseCountDelta ?? 0) !== 0;
  const undone = params.reset ? { next: applied.next, reasons: [] } : undoImpossible(ctx.constraints, applied.next, outcome, shownCount, countAsked);
  if (undone.reasons.length > 0) {
    applied = { ...applied, next: undone.next };
    changed = relabel(changesOf(params, undone.next));
    outcome = runPlanTurn(solveFor(undone.next), undone.next, shown, changed, periodNamesFor(ctx.record.student.school));
  }
  // 拿掉的課是某一類這學期唯一能補的（「我不想修人生哲學」，全人核心只有它）：整份課表會排不出來。
  // 不套用這個排除、講清楚為什麼，而不是回「查無開課，請洽系辦加開」（TODO G12：必修沒得換就保留）
  const kept: string[] = [];
  const newExcl = applied.next.excludeCourses.filter((c) => !ctx.constraints.excludeCourses.includes(c));
  if (!outcome.solve.ok && newExcl.length > 0) {
    const without = { ...applied.next, excludeCourses: applied.next.excludeCourses.filter((c) => !newExcl.includes(c)) };
    const changedWithout = relabel(changesOf(params, without));
    const retry = runPlanTurn(solveFor(without), without, shown, changedWithout, periodNamesFor(ctx.record.student.school));
    if (retry.solve.ok) {
      const cats = [...new Set(outcome.solve.infeasibilities.map((i) => i.category.replace(/\s*\d+\s*學分$/, "")))].join("、");
      const names = newExcl.map((c) => `「${courseName(c, ctx)}」`).join("、");
      kept.push(`${names}是${cats ? `「${cats}」` : "必修"}這學期唯一能補的課，拿掉就排不出課表，所以先保留。`);
      applied = { ...applied, next: without };
      changed = changedWithout;
      outcome = retry;
    }
  }
  // 「輕鬆一點」卻沒變：已經在學期學分下限了，要講出來，不然看起來像沒聽懂
  const light: string[] = [];
  const nowPlan = outcome.solve.ok ? outcome.solve.plans[0] : undefined;
  if (applied.next.goal === "light" && ctx.constraints.goal !== "light" && outcome.diff.unchanged && nowPlan) {
    const min = solveFor(applied.next).termMinCredits;
    if (nowPlan.totalCredits <= min) light.push(`這份課表 ${nowPlan.totalCredits} 學分，已經是學期學分下限 ${min} 學分，沒辦法再少。`);
  }
  const notDone = [...undone.reasons, ...kept, ...light, ...unsupportedAsks(raw)];

  // 條件沒變（做不到、已是現狀、沒抓到要改什麼）：回覆說「課表維持原樣」，就真的回畫面上那份。
  // 重新求解的結果可能換了別的課或別的班 —— 嘴上說沒改、課表卻變了（「少一堂課」實測）
  if (outcome.changed.length === 0 && shown && outcome.solve.ok) {
    outcome = {
      ...outcome,
      solve: { ...outcome.solve, plans: [shown, ...outcome.solve.plans.slice(1)] },
      diff: { added: [], removed: [], moved: [], unchanged: true },
    };
  }

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
    reply: planReply(outcome, requested, notDone),
    tools,
    intent: intent.intent,
    clarifying: false,
    plan: { ...outcome, constraintSet: applied.next, refusedParams: applied.refusedParams },
  };
}

/**
 * 使用者眼前的課表：依目前條件重新求一次，平手時偏向前端說它正在顯示的那幾門。
 *
 * 不直接拿前端送來的課號組課表：那是不可信輸入，而且課表要帶學分、時段、警告，
 * 那些只能由求解器產生。以目前條件求解、再用課號當平手偏好，求出來的就是畫面上那一份
 * （上一輪也是這樣求出來的）；前端亂送課號，最多只是平手時的順序不同，不會產生不可行的課表。
 * 目前條件本身無解時，畫面上也沒有課表。
 */
function shownPlan(ctx: TurnContext): Plan | undefined {
  const base = buildContext(ctx.audit, ctx.record, ctx.pack, ctx.constraints);
  // 畫面上那份要原樣重建：每一門都排進來、不多排（TODO G12）。只是「盡量保留」的話，
  // 重建出來的可能跟使用者看到的不一樣，「拿掉哪一門」「課表差在哪」就會對不上
  const shownCodes = ctx.shownCodes ?? [];
  // 只有時段對得上的那一班可選；對不上任何一班（開課資料更新過）就不限制，免得整門課消失
  const slots = ctx.shownSlots ?? {};
  const sameSection = (o: Offering) => {
    const want = slots[o.code];
    if (!want || !base.offerings.some((x) => x.code === o.code && slotTextOf(x) === want)) return true;
    return slotTextOf(o) === want;
  };
  const solveCtx =
    shownCodes.length > 0
      ? {
          ...base,
          offerings: base.offerings.filter(sameSection),
          keep: shownCodes,
          continueCodes: new Set([...(base.continueCodes ?? []), ...shownCodes]),
          constraints: { ...base.constraints, maxCourseCount: shownCodes.length },
        }
      : { ...base, keep: ctx.shownCodes };
  const o = runPlanTurn(solveCtx, ctx.constraints, undefined, [], periodNamesFor(ctx.record.student.school));
  return o.solve.ok ? o.solve.plans[0] : undefined;
}

/**
 * 這一輪要的條件做不到時退回原狀，並寫出做不到的原因。
 *
 * - 上課天數：排不進 → 求解器回報「上課天數」無解。這是新加的硬限制，
 *   做不到就不記下來，使用者不必先「放寬」一個從沒生效過的條件。
 * - 堂數：期望堂數是軟偏好，做不到時求解器照排、只附一句警告，於是畫面會說
 *   「已改為期望 1 堂課」而課表紋風不動。只在課表**完全沒因此改變**時退回；
 *   往期望的方向移動了一部分就照做（盡量改），剩下的差距由代價說明。
 *
 * 其餘硬限制（空出某天、某時段）維持 docs/CONVERSATION.md §1.4 的做法：
 * 套用、回報無解、提出放寬選項，由使用者決定放寬哪一項。
 */
function undoImpossible(
  before: ConstraintSet,
  after: ConstraintSet,
  o: PlanTurnOutcome,
  shownCount: number | undefined,
  countAsked: boolean,
): { next: ConstraintSet; reasons: string[] } {
  const next = { ...after };
  const reasons: string[] = [];

  if (after.maxDays !== undefined && after.maxDays !== before.maxDays && !o.solve.ok) {
    const why = o.solve.infeasibilities.find((i) => i.category === "上課天數");
    if (why) {
      reasons.push(`${why.suggestion}。`);
      next.maxDays = before.maxDays;
    }
  }

  const want = after.targetCourseCount;
  if (countAsked && want !== undefined && o.solve.ok) {
    const plan = o.solve.plans[0]!;
    const got = plan.courses.length;
    if (got !== want && got === shownCount) {
      const prefix = `你期望 ${want} 堂課，但`;
      const w = plan.warnings.find((x) => x.startsWith(prefix));
      reasons.push(w ? `排不到 ${want} 堂：${w.slice(prefix.length)}` : `排不到 ${want} 堂，目前的條件下只能排 ${got} 堂。`);
      next.targetCourseCount = before.targetCourseCount;
    }
  }

  return { next, reasons };
}

/**
 * 使用者說了、但系統表達不了的要求。不能默默丟掉 —— 要講出來，使用者才知道那部分沒做。
 * 「多選一堂兩學分的課」的「兩學分」是那門課的學分數，目前沒有這個條件。
 */
function unsupportedAsks(raw: string): string[] {
  const t = raw.replace(/\s/g, "");
  const out: string[] = [];
  // 「只修三學分的課」說的是整份課表每一門 —— 現在只支援「新加的那門幾學分」（TODO G1）
  if (/只(?:想)?(?:修|選|上)(\d+|[一二兩三四五六七八九十])學分的課|都要(\d+|[一二兩三四五六七八九十])學分/.test(t)) {
    out.push("目前只能指定新加的那門課要幾學分，不能指定整份課表每門課的學分，這部分沒有套用。");
  }
  return out;
}

/**
 * §1.3 每輪回報三件事：改了什麼條件、課表差異、代價。
 * requested：這一輪有沒有抓到任何具體要求（見 ApplyResult.requested）。
 * notDone：這一輪要的、但沒有套用的部分（做不到或表達不了），一定要講出來。
 */
function planReply(o: PlanTurnOutcome, requested: boolean, notDone: string[] = []): Reply {
  const note = notDone.join("\n");

  if (!o.solve.ok) {
    return uncertain({
      headline: "在這些條件下找不到可行的組合。",
      detail: [
        note,
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
  // 沒變動有三種原因，要分開講：做不到、要求已是現狀、根本沒抓到要改什麼。
  // 說成「與目前設定相同」只有在真的抓到了要求、而且那就是現狀時才是實話。
  if (o.changed.length === 0 && notDone.length > 0) {
    return {
      kind: "決定",
      headline: "這個要求做不到，課表維持原樣。",
      detail: [note, `目前條件：${o.constraints.join("・")}`].join("\n"),
      citations: [],
    };
  }
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
        (o.diff.moved ?? []).length > 0 ? `換班：${o.diff.moved!.join("、")}` : "",
      ]
        .filter(Boolean)
        .join("；") + "。";

  return {
    kind: "決定",
    headline: `已${o.changed.join("、")}。`,
    detail: note ? `${diff}\n${note}` : diff,
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
  "already-taken": "已經修過",
  "later-grade": "規劃表排在比較高的年級",
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
  const forRules = withoutOwnSchool(lastUser(messages), schoolOf(ctx.record.student));
  let intent = await orRules(parseAskIntent(messages, budget), () => ruleAskIntent(forRules), tools);

  // 與 planTurn 相同的安全網與後援：規則可以多擋、可以補上模型漏判的路由，
  // 但絕不推翻模型的拒絕
  const rules = ruleAskIntent(forRules);
  intent = correctOtherInstitution(intent, rules, tools);
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
  } else if (
    intent.kind === "out-of-scope" &&
    !tools.includes("rule.other-institution") &&
    mentionsGraduationCheck(forRules, ctx.pack)
  ) {
    // 實測 qwen3:14b 把「英文要考到多少才能畢業」「程式語言機測是什麼」判成超出範圍，
    // 規則的通用關鍵字也認不得系自訂的條件名稱；原句講到本系的畢業條件就當規定問題查
    intent = { kind: "intent", intent: "regulation", params: { topic: forRules, raw: lastUser(messages) } };
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
          // 原句說的是分項條件（「系專選」「本系專業選修」）就用它：模型常會填成上一層的類別
          subRuleFrom(ctx.audit, p.raw) ??
          spokenCategory(p.category, p.raw) ??
            (rules.kind === "intent" && rules.intent === "personal-audit" ? rules.params.category : undefined) ??
            // 規則與模型都沒認出類別時，拿這位學生自己的類別名稱去比原句：
            // 輔大的「院系必修課程」「本系專業選修」不在規則的固定清單裡
            categoryFromText(ctx.audit, p.raw),
        ),
        tools,
        intent: intent.intent,
        clarifying: false,
      };

    case "regulation":
      tools.push("rule.lookup");
      return {
        // 原句跟模型抽的主題一起查：模型常把「英文畢業門檻」縮成「畢業門檻」，只用它查會答成最低畢業學分
        reply: answerRegulation(p.topic && !p.raw.includes(p.topic) ? `${p.raw}　${p.topic}` : p.raw, ctx.pack, ctx.audit),
        tools,
        intent: intent.intent,
        clarifying: false,
      };

    case "course-info":
      tools.push("course.search");
      return {
        reply: lookup(p.course, p.raw, (q) => answerCourseInfo(q, ctx.audit.nextTerm, schoolOf(ctx.record.student), ctx.record.student.dept)),
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

/** 把規則抽到、模型卻留空（null、false 或空陣列）的欄位補上；沒有可補的就原樣回傳同一個物件 */
export function fillEmpty<T extends object>(model: T, rules: T): T {
  const out = { ...model } as Record<string, unknown>;
  let filled = false;
  for (const [k, v] of Object.entries(rules)) {
    const m = out[k];
    // false 也算留空：模型會把沒提到的開關隨手填 false（見「模型隨手填的 false 是雜訊」測試）
    const empty = m === null || m === undefined || m === false || (Array.isArray(m) && m.length === 0);
    const has = v !== null && v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0);
    if (empty && has) {
      out[k] = v;
      filled = true;
    }
  }
  return filled ? (out as T) : model;
}

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

/**
 * 模型判成「他校事務」、但句子裡根本沒有別的學校（TODO G3）。
 *
 * 實測 qwen3:14b 對「今天天氣如何」拒絕時套用「他校事務」的說法，轉介到錯的單位；
 * 模型也不知道學生讀哪一所，輔大學生問「輔大的規定」會被它當成問別校。
 * 「他校」是看得到證據的：句子裡要有別的學校的名字（自己學校的稱呼已換成「本校」）。
 * 規則找不到 —— 規則看得懂這句話就照規則走；看不懂就是一般的超出範圍。
 *
 * 這是「規則不推翻模型拒絕」的唯一例外：拒絕的依據是事實錯誤（把本校當他校），不是判斷不同。
 * 其他禁止主題（成績預測、教師評價…）照舊，規則只能多擋、不能放行。
 */
function correctOtherInstitution<T extends { kind: string }>(intent: T, rules: T, tools: string[]): T {
  const topic = (intent as { topic?: string }).topic;
  if (intent.kind !== "forbidden" || topic !== "other-institution" || rules.kind === "forbidden") return intent;
  tools.push("rule.other-institution");
  return rules.kind === "intent" ? rules : ({ kind: "out-of-scope" } as unknown as T);
}

// ---------------------------------------------------------------- 拿掉某一類（TODO G12）

/**
 * 要拿掉的類別說法是否成立：原句真的提到（至少兩個連續字），而且跟規則包某一類的名稱
 * 有兩個連續字相同（去掉「課程」後比）。「早上的課」「」都不算。
 */
export function isDropCategory(category: string | null | undefined, raw: string, pack: RulePack): boolean {
  const word = (category ?? "").replace(/課程|\s/g, "");
  if (word.length < 2 || !spokenCategory(word, raw)) return false;
  const pairs = (s: string) => new Set([...s].slice(0, -1).map((_, i) => s.slice(i, i + 2)));
  const mine = pairs(word);
  return pack.categories.some((c) => [...pairs(c.name.replace(/課程|\s/g, ""))].some((p) => mine.has(p)));
}

/** 我們問「要拿掉一門，還是這學期都不排？」時的固定問句；用來認出下一句是在回答它 */
const DROP_ASK = "還是這學期都不排";

/**
 * 上一輪問了「要拿掉一門，還是這學期都不排？」，這一句只回「一門」「全部」：
 * 接回上一句使用者的話再解析，否則「一門」單獨看不出要拿掉什麼。
 */
function withDropAnswer(messages: ChatMessage[]): string | undefined {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return undefined;
  const t = last.content.replace(/\s/g, "");
  if (!/^(?:拿掉)?(?:一[門堂個]|1[門堂個]?|全部|都(?:拿掉|不排|不要)|這學期都不排|全拿掉|全不排)/.test(t) || t.length > 12) return undefined;
  const ask = [...messages].reverse().find((m) => m.role === "assistant");
  if (!ask || !ask.content.includes(DROP_ASK)) return undefined;
  const i = messages.lastIndexOf(ask);
  const prevUser = messages.slice(0, i).reverse().find((m) => m.role === "user");
  if (!prevUser) return undefined;
  const all = /全|都/.test(t);
  // 問句最後的「…都不排「通識」？」就是要拿掉的類別
  const word = [...ask.content.matchAll(/「([^」]+)」/g)].at(-1)?.[1];
  if (!word) return undefined;
  return `${prevUser.content}，${all ? `這學期都不排${word}` : `拿掉一堂${word}`}`;
}

type DropResult = {
  /** 有拿掉或改拿另一門：呼叫端要重算堂數 */
  applies: boolean;
  /** 要先問使用者，或課表上根本沒有那一類 */
  reply?: Reply;
  excludeCodes: string[];
  /** 「換另一門」：上次拿掉的那門放回來 */
  unexclude: string[];
  removedCount: number;
  skip: { id: string; name: string }[];
  lastDrop?: { category: string; code: string };
  /** 把「排除 生死學」改寫成說明為什麼是這一門 */
  relabel: (changed: string[]) => string[];
};

/**
 * 「拿掉一堂通識」：從眼前課表上那一類的課挑一門拿掉，並講明是哪一門、為什麼是它。
 * 挑法：早八的先拿；其次是那天只有它一門（拿掉可以空出一天）；再來是清單後面的。
 * 沒說幾門、課表上又不只一門 → 先問「要拿掉一門，還是這學期都不排？」
 * 「這學期都不排」→ 整類跳過（skipCategories），學分留到之後的學期。
 * 「換另一門」→ 上次拿掉的放回來，改拿同一類的下一門。
 */
function resolveDrop(params: PlanParams, raw: string, shown: Plan | undefined, ctx: TurnContext): DropResult {
  const none: DropResult = { applies: false, excludeCodes: [], unexclude: [], removedCount: 0, skip: [], relabel: (c) => c };
  const courses = shown?.courses ?? [];
  const t = raw.replace(/\s/g, "");
  const another = params.dropAnother || /換另一門|換別門|拿另一門|換另外一門/.test(t) ? ctx.constraints.lastDrop : undefined;
  const drop = params.dropCategory ?? (another ? { category: another.category, count: 1 } : null);
  if (!drop) return none;

  const word = drop.category;
  const inShown = courses.filter((c) => c.categoryLabel.includes(word));
  const cat = ctx.pack.categories.find((c) => c.name.includes(word));
  const label = cat?.name ?? word;

  if (drop.count === "all") {
    if (!cat) {
      return { ...none, reply: uncertain({ headline: `你的畢業規定裡沒有「${word}」這一類。`, searched: ["適用的課程規劃表"], contact: "可以改說課名，例如「把某某課拿掉」" }) };
    }
    return {
      ...none,
      applies: true,
      removedCount: inShown.length,
      skip: [{ id: cat.id, name: cat.name }],
      relabel: (changed) => changed,
    };
  }

  // 「換另一門」：上次拿掉的放回來，不算進候選
  const pool = another ? inShown.filter((c) => c.code !== another.code) : inShown;
  if (pool.length === 0) {
    return {
      ...none,
      reply: uncertain({
        headline: another ? `課表上沒有其他「${label}」的課可以換。` : `課表上沒有「${label}」的課。`,
        searched: ["目前畫面上的課表"],
        contact: "可以直接說要拿掉哪一門課",
      }),
    };
  }
  let n = drop.count;
  if (n === null) {
    if (pool.length >= 2) {
      return { ...none, reply: { kind: "不確定", headline: `課表上有 ${pool.length} 門「${label}」：要拿掉一門，${DROP_ASK}「${word}」？`, searched: [], citations: [] } };
    }
    n = 1;
  }

  // 挑哪一門：早八 → 那天只有它（拿掉空出一天）→ 清單後面的
  const dayCount = new Map<number, number>();
  for (const c of courses) for (const d of new Set(c.slots.map((s) => s.day))) dayCount.set(d, (dayCount.get(d) ?? 0) + 1);
  const reason = (c: (typeof courses)[number]) =>
    isEarlyMorning(c.slots) ? "早八" : c.slots.length > 0 && [...new Set(c.slots.map((s) => s.day))].every((d) => dayCount.get(d) === 1) ? "那天只有這門課，拿掉可以空出一天" : undefined;
  const rank = (c: (typeof courses)[number]) => (isEarlyMorning(c.slots) ? 0 : reason(c) ? 1 : 2);
  const picked = [...pool]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || b.i - a.i)
    .slice(0, Math.min(n, pool.length))
    .map((x) => x.c);

  const why = new Map(picked.map((c) => [c.code, reason(c)]));
  const others = pool.length - picked.length;
  return {
    applies: true,
    excludeCodes: picked.map((c) => c.code),
    unexclude: another ? [another.code] : [],
    removedCount: picked.length,
    skip: [],
    lastDrop: picked.length === 1 ? { category: word, code: picked[0]!.code } : undefined,
    relabel: (changed) =>
      [...(another ? [`放回 ${courseName(another.code, ctx)}`] : []), ...changed].map((line) => {
        const c = picked.find((p) => line === `排除 ${p.name}` || line.startsWith(`排除 ${p.name}（`));
        if (!c) return line;
        const w = why.get(c.code);
        return `拿掉「${label}」的${c.name}${w ? `（${w}）` : ""}${others > 0 ? "；想拿另一門可以說「換另一門」" : ""}`;
      }),
  };
}

/** 一定要保留的課（見 planTurn 的 solveFor）：眼前課表上、這一輪沒被點名也沒違反條件的課 */
function strictKeep(shown: Plan | undefined, set: ConstraintSet, offerings: Offering[]): string[] {
  const skip = new Set((set.skipCategories ?? []).map((c) => c.id));
  return (shown?.courses ?? [])
    .filter((c) => !set.excludeCourses.includes(c.code))
    .filter((c) => !skip.has(c.category))
    .filter((c) => {
      if (!set.avoidEarly) return true;
      const sections = offerings.filter((o) => o.code === c.code);
      const onlyEarly = sections.length > 0 && sections.every((o) => isEarlyMorning(o.slots));
      // 只開早八、又不是必修：有替代就換（同一類的別門課由排課補上）
      return !onlyEarly || sections.some((o) => o.selectType === "required");
    })
    .map((c) => c.code);
}

/** 課號 → 課名（下學期開課資料裡的名稱；查不到就用課號） */
function courseName(code: string, ctx: TurnContext): string {
  const [y, t] = ctx.audit.nextTerm.split("-").map(Number) as [number, 1 | 2];
  return offeringsFor(y, t, schoolOf(ctx.record.student)).find((o) => o.code === code)?.name ?? code;
}

/** 原句指的是某個分項條件（見 capabilities 的 categoryFromText）時回傳它的名稱 */
function subRuleFrom(audit: AuditResult, raw: string): string | undefined {
  const name = categoryFromText(audit, raw);
  return name && subRuleNamed(audit, name) ? name : undefined;
}
