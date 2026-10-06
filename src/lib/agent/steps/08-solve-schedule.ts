import type { Plan, ToolCall } from "@/lib/types";
import type { Step } from "./types";
import { scheduleSolve } from "../tools";
import {
  constraintsFrom,
  describeConstraints,
  requirementsFrom,
  reservedFrom,
  PRESET_OF_GOAL,
  type SolveContext,
} from "@/lib/solver/schedule";
import { preferencesOf } from "@/lib/chat/apply";
import { termLimitsFor } from "@/lib/rules/term-limits";
import { continuingCourseCodes, takenCourseCodes } from "@/lib/solver/taken";
import { classProfileOf } from "@/lib/offerings/class-group";

/**
 * 步驟 8：選課組合求解。
 *
 * 第一版課表依學生於基本資料填寫的**選課傾向**產生，而不是先給三個罐頭方案
 * 再要使用者從頭調 —— 使用者已經說過自己要什麼，系統就該從那裡開始。
 * 後續的「不要早八」「少一堂課」由 /api/plan 的對話式微調處理。
 *
 * 無解 → 回報衝突原因並放寬條件重試 1 次；放寬了什麼會寫進 trace 與 UI。
 */
export const solveScheduleStep: Step = {
  name: "solveSchedule",
  label: "依選課傾向求解課表",
  async run({ trace, state }) {
    const audit = state.audit!;
    const requirements = requirementsFrom(audit);
    const limits = termLimitsFor(state.pack!, state.record!.student, state.nextTerm);
    const preferences = preferencesOf(state.record!.preferences);
    const passedCodes = new Set(
      state.record!.courses
        .filter((c) => c.status === "passed" || c.status === "waived")
        .map((c) => c.equivalentOf ?? c.code),
    );

    const ctx: SolveContext = {
      offerings: state.offerings,
      requirements,
      passedCodes,
      takenCodes: takenCourseCodes(state.record!.courses, state.pack!),
      continueCodes: continuingCourseCodes(state.record!.courses, state.pack!),
      admissionYear: state.record!.student.admissionYear,
      studentDept: state.record!.student.dept, classProfile: classProfileOf(state.record!.student, state.pack!.college),
      reserved: reservedFrom(state.record!.plannedCommitments),
      preferences,
      constraints: constraintsFrom(preferences, limits),
      termLabel: state.nextTerm,
      termMinCredits: limits.minCredits,
      termMaxCredits: limits.maxCredits,
    };

    const calls: ToolCall[] = [];
    const preset = PRESET_OF_GOAL[preferences.goal];

    const { data, call } = await trace.tool(
      "schedule.solve",
      {
        preset,
        preferences,
        constraints: describeConstraints(ctx.constraints, preferences),
        requirements: requirements.map((r) => r.label),
      },
      async () => {
        const r = scheduleSolve(ctx, preset);
        return {
          data: r,
          status: r.ok ? ("ok" as const) : ("partial" as const),
          output: r.ok
            ? {
                plans: r.plans.map((p) => ({
                  id: p.id,
                  credits: p.totalCredits,
                  courses: p.courses.map((c) => c.code),
                  unmetAfter: p.unmetAfter,
                  warnings: p.warnings,
                })),
                relaxations: r.relaxations,
              }
            : { infeasibilities: r.infeasibilities, relaxations: r.relaxations },
        };
      },
    );
    calls.push(call);
    state.solve = data;

    if (!data.ok) {
      const cats = [...new Set(data.infeasibilities.map((i) => i.category))];
      return {
        status: "held",
        summary: `依選課傾向求解無解，受限類別：${cats.join("、")}；已回報衝突條件與建議放寬項目`,
        retries: 1,
        toolCalls: calls,
        control: { type: "skip", steps: ["retrieveDiscussions", "scanExternal"] },
      };
    }

    const plans: Plan[] = data.plans;
    state.plans = plans;

    const first = plans[0]!;
    const unmetWarn = first.warnings.length > 0 ? `；${first.warnings.length} 項偏好無法完全滿足` : "";
    return {
      status: data.relaxations.length > 0 ? "retried" : "ok",
      summary:
        `依選課傾向（${describeConstraints(ctx.constraints, preferences).join("、")}）求得 ` +
        `${plans.length} 組方案，首選 ${first.totalCredits} 學分／${first.courses.length} 門` +
        unmetWarn +
        (data.relaxations.length > 0 ? `；已放寬條件：${data.relaxations.join("、")}` : ""),
      retries: data.relaxations.length > 0 ? 1 : 0,
      toolCalls: calls,
    };
  },
};
