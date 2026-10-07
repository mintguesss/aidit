import type { AuditResult, Trace, Verdict } from "@/lib/types";
import { TraceCollector, ToolFailure } from "./trace";
import { LlmBudget } from "@/lib/llm/client";
import { newTraceId, studentHash } from "@/lib/util/identity";
import type { AgentState, AuditRequest, Step, StepOutcome } from "./steps/types";
import { fetchRecordStep } from "./steps/01-fetch-record";
import { resolveRuleVersionStep } from "./steps/02-resolve-rule-version";
import { detectConflictsStep } from "./steps/03-detect-conflicts";
import { reconcileConflictsStep } from "./steps/04-reconcile-conflicts";
import { auditCreditsStep } from "./steps/05-audit-credits";
import { verifyCitationsStep } from "./steps/06-verify-citations";
import { searchOfferingsStep } from "./steps/07-search-offerings";
import { solveScheduleStep } from "./steps/08-solve-schedule";

/**
 * Step runner（docs/SPEC.md §6）。
 *
 * 刻意不使用 agent 框架：流程是有限且已知的，用一個 step runner 就夠，
 * 而且 trace 的格式要能自己控制 —— trace 是決賽的交付項目。
 */

const STEPS: Step[] = [
  fetchRecordStep,
  resolveRuleVersionStep,
  detectConflictsStep,
  reconcileConflictsStep,
  auditCreditsStep,
  verifyCitationsStep,
  searchOfferingsStep,
  solveScheduleStep,
];

export type RunOutcome =
  | { ok: true; audit: AuditResult; trace: Trace; state: AgentState }
  | { ok: false; trace: Trace; error: { reason: string; kind: "abort" | "all-hold" }; state: AgentState };

export async function runAudit(request: AuditRequest): Promise<RunOutcome> {
  const traceId = newTraceId();
  const trace = new TraceCollector(traceId);
  const budget = new LlmBudget();

  const currentTerm = request.currentTerm ?? "114-2";
  const [curYear, curTerm] = parseTerm(currentTerm);
  const { nextTerm, nextYear } = advanceTerm(curYear, curTerm);

  const state: AgentState = {
    request,
    conflicts: [],
    reconciled: [],
    conflictNotes: [],
    deptDefinedResolutions: {},
    capabilityHolds: [],
    offerings: [],
    plans: [],
    currentTerm,
    nextTerm,
    nextYear,
  };

  const skipped = new Set<string>();
  let control: { kind: "abort" | "all-hold"; reason: string } | null = null;

  for (const step of STEPS) {
    if (control) break;
    if (skipped.has(step.name)) {
      trace.pushStep({
        name: step.name,
        label: step.label,
        status: "skipped",
        summary: "依前一步驟之分支結果略過",
        retries: 0,
        ms: 0,
        toolCalls: [],
      });
      continue;
    }

    const t0 = Date.now();
    let outcome: StepOutcome;
    try {
      outcome = await step.run({ trace, state, budget });
    } catch (err) {
      const failure = err instanceof ToolFailure ? err : null;
      const reason = failure
        ? `${step.label}失敗：${failure.call.error}`
        : `${step.label}失敗：${String(err instanceof Error ? err.message : err)}`;
      outcome = {
        status: "failed",
        summary: reason,
        toolCalls: failure ? [failure.call] : [],
        control: { type: "abort", reason },
      };
    }

    trace.pushStep({
      name: step.name,
      label: step.label,
      status: outcome.status,
      summary: outcome.summary,
      retries: outcome.retries ?? 0,
      ms: Date.now() - t0,
      toolCalls: outcome.toolCalls ?? [],
    });

    const c = outcome.control;
    if (c?.type === "abort") control = { kind: "abort", reason: c.reason };
    else if (c?.type === "all-hold") control = { kind: "all-hold", reason: c.reason };
    else if (c?.type === "skip") for (const s of c.steps) skipped.add(s);
  }

  const hash = state.record ? studentHash(state.record.student.id) : "unknown";
  const packId = state.pack?.id ?? "unresolved";
  const packVersion = state.pack?.version ?? "-";

  if (control) {
    const t = trace.finish({
      studentHash: hash,
      rulePackId: packId,
      rulePackVersion: packVersion,
      status: control.kind === "all-hold" ? "held" : "error",
      llm: budget.usage,
      abortReason: control.reason,
    });
    return { ok: false, trace: t, error: { reason: control.reason, kind: control.kind }, state };
  }

  const audit = state.audit!;
  audit.verdict = adjustVerdictForHolds(audit.verdict, audit.holds.length);

  const t = trace.finish({
    studentHash: hash,
    rulePackId: packId,
    rulePackVersion: packVersion,
    status: audit.holds.length > 0 ? "held" : "ok",
    llm: budget.usage,
  });
  return { ok: true, audit, trace: t, state };
}

/**
 * 有待確認事項時，結論句必須明說「這些項目未計入」。
 * 不加這一句，使用者會把一個有洞的結論當成完整判定。
 */
function adjustVerdictForHolds(v: Verdict, holds: number): Verdict {
  if (holds === 0) return v;
  return { ...v, detail: `${v.detail}本次判定未計入 ${holds} 項待確認事項。` };
}

function parseTerm(label: string): [number, 1 | 2] {
  const m = /^(\d+)-([12])$/.exec(label);
  if (!m) throw new Error(`學期代號格式錯誤：${label}`);
  return [Number(m[1]), Number(m[2]) as 1 | 2];
}

function advanceTerm(year: number, term: 1 | 2): { nextTerm: string; nextYear: number } {
  return term === 1
    ? { nextTerm: `${year}-2`, nextYear: year }
    : { nextTerm: `${year + 1}-1`, nextYear: year + 1 };
}
