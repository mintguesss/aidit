import { NextResponse } from "next/server";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { resolveRulePack } from "@/lib/rules/loader";
import { askTurn, planTurn, type TurnContext } from "@/lib/chat/route";
import { constraintSetFrom, describeSet, preferencesOf } from "@/lib/chat/apply";
import { render } from "@/lib/chat/compose";

import { LlmBudget, LlmBudgetExceeded } from "@/lib/llm/client";
import { traceStore } from "@/lib/store";
import { TraceCollector } from "@/lib/agent/trace";
import { newTraceId, studentHash } from "@/lib/util/identity";
import type { ChatMessage, ConstraintSet } from "@/lib/chat/types";
import { LIMITS } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  fixture?: string;
  term?: string;
  /** A = 課表微調，B = 修業問答 */
  scope?: "plan" | "ask";
  messages?: ChatMessage[];
  /** A 介面目前生效的約束集合 */
  constraints?: ConstraintSet;
};

/**
 * POST /api/chat —— 兩個對話介面共用的入口（docs/CONVERSATION.md）。
 *
 * §0.1　LLM 只輸出意圖與參數；回覆文字由 compose.ts 從引擎結果組出來。
 * §0.6　每輪都寫 trace：意圖、呼叫了哪些工具、耗時、是否轉人工。
 * §0.7　每輪 LLM 呼叫 ≤ 2 次；單一 session ≤ 20 輪。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const messages = (body?.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-2 * LIMITS.turnsPerSession)
    .map((m) => ({ ...m, content: m.content.slice(0, 1000) }));

  if (messages.length === 0) {
    return NextResponse.json({ error: "缺少對話內容。" }, { status: 400 });
  }

  const scope = body?.scope === "plan" ? "plan" : "ask";
  const { fixture, term } = parsePageParams({ fixture: body?.fixture, term: body?.term });
  const session = await getAuditSession(fixture, term);

  if (!session.outcome.ok) {
    return NextResponse.json({
      reply: {
        kind: "不確定",
        headline: "本案已轉人工審查，系統沒有可據以回答的判定結果。",
        detail: session.outcome.error.reason,
        searched: ["審查引擎"],
        contact: "系辦公室或教務處註冊組",
        citations: [],
      },
      traceId: session.outcome.trace.id,
    });
  }

  const { audit, state } = session.outcome;
  const record = state.record!;
  const resolved = resolveRulePack(record.student);
  if (!resolved.ok) return NextResponse.json({ error: resolved.detail }, { status: 422 });

  const original = constraintSetFrom(preferencesOf(record.preferences));
  const constraints = body?.constraints ? sanitise(body.constraints, original) : original;

  const ctx: TurnContext = {
    audit,
    record,
    pack: resolved.pack,
    constraints,
    originalConstraints: original,
    currentPlan: state.plans[0],
  };

  // §0.6 每輪都寫 trace
  const trace = new TraceCollector(newTraceId());
  const budget = new LlmBudget(LIMITS.llmCallsPerTurn);
  const started = Date.now();

  let turn;
  try {
    turn = scope === "plan" ? await planTurn(messages, ctx, budget) : await askTurn(messages, ctx, budget);
  } catch (err) {
    if (err instanceof LlmBudgetExceeded) {
      return NextResponse.json(
        {
          reply: {
            kind: "不確定",
            headline: `本輪的模型呼叫已達上限（${LIMITS.llmCallsPerTurn} 次）。`,
            detail: "請把問題拆成兩句再試一次。",
            searched: [],
            contact: "系辦公室",
            citations: [],
          },
        },
        { status: 429 },
      );
    }
    return NextResponse.json({
      reply: {
        kind: "不確定",
        headline: "這次沒能處理你的問題。",
        detail: "請換個說法再試一次。",
        searched: [],
        contact: "系辦公室",
        citations: [],
      },
    });
  }

  trace.pushStep({
    name: scope === "plan" ? "planTurn" : "askTurn",
    label: scope === "plan" ? "課表微調對話" : "修業問答對話",
    status: turn.reply.kind === "決定" ? "ok" : turn.reply.kind === "不確定" ? "held" : "skipped",
    summary:
      `意圖 ${turn.intent}；回答類型「${turn.reply.kind}」；` +
      `呼叫 ${turn.tools.join("、")}` +
      (turn.clarifying ? "；向使用者提問" : "") +
      `；LLM ${budget.usage.calls} 次`,
    retries: 0,
    ms: Date.now() - started,
    toolCalls: turn.tools.map((name) => ({ name, input: null, output: null, ms: 0, status: "ok" as const })),
  });

  const t = trace.finish({
    studentHash: studentHash(record.student.id),
    rulePackId: resolved.pack.id,
    rulePackVersion: resolved.pack.version,
    status: turn.reply.kind === "決定" ? "ok" : "held",
    llm: budget.usage,
  });
  await traceStore().saveTrace(t).catch(() => undefined);

  return NextResponse.json({
    reply: turn.reply,
    text: render(turn.reply),
    intent: turn.intent,
    clarifying: turn.clarifying,
    tools: turn.tools,
    traceId: t.id,
    llm: budget.usage,
    explanation: turn.explanation,
    whatif: turn.whatif,
    redirect: turn.redirect,
    plan: turn.plan
      ? {
          plans: turn.plan.solve.ok ? turn.plan.solve.plans : [],
          conflicts: turn.plan.solve.ok ? undefined : turn.plan.solve.infeasibilities,
          excluded: turn.plan.solve.excluded,
          constraints: turn.plan.constraintSet,
          constraintLabels: describeSet(turn.plan.constraintSet),
          changed: turn.plan.changed,
          diff: turn.plan.diff,
          costs: turn.plan.costs,
          relaxOptions: turn.plan.relaxOptions,
        }
      : undefined,
  });
}

/** 前端送上來的約束集合要當成不可信輸入 */
function sanitise(c: ConstraintSet, fallback: ConstraintSet): ConstraintSet {
  const days = (x: unknown) =>
    Array.isArray(x) ? [...new Set(x.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))] : [];
  const codes = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && /^[A-Z]{2}\d{4}$/.test(s)).slice(0, 10) : [];
  const num = (x: unknown, lo: number, hi: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : undefined;

  return {
    goal: ["asap", "balanced", "light"].includes(c?.goal) ? c.goal : fallback.goal,
    avoidEarly: Boolean(c?.avoidEarly),
    avoidDays: days(c?.avoidDays),
    avoidPeriods: Array.isArray(c?.avoidPeriods)
      ? c.avoidPeriods
          .filter((a) => Number.isInteger(a?.day) && Array.isArray(a?.periods))
          .slice(0, 7)
          .map((a) => ({ day: a.day, periods: a.periods.filter((p) => Number.isInteger(p)).slice(0, 14) }))
      : [],
    maxCredits: num(c?.maxCredits, 0, 30),
    minCredits: num(c?.minCredits, 0, 30),
    targetCourseCount: num(c?.targetCourseCount, 0, 10),
    preferCompactDays: Boolean(c?.preferCompactDays),
    excludeCourses: codes(c?.excludeCourses),
    pinCourses: codes(c?.pinCourses),
    goals: Array.isArray(c?.goals)
      ? c.goals.filter((g): g is ConstraintSet["goals"][number] =>
          ["early-graduation", "minor", "cert-program"].includes(g as string),
        )
      : [],
    note: typeof c?.note === "string" ? c.note.slice(0, 200) : fallback.note,
  };
}
