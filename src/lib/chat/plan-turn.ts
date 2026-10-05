import type { AuditResult, Plan, SolveResult, StudentRecord } from "@/lib/types";
import type { RulePack } from "@/lib/rules/schema";
import { offeringsFor, remainingSeats } from "@/lib/offerings";
import {
  explainCourse,
  requirementsFrom,
  reservedFrom,
  solve,
  PRESET_OF_GOAL,
  type SolveContext,
} from "@/lib/solver/schedule";
import { describeSet, toSolverConstraints, DEMO_PERIOD_NAMES, type PeriodNames } from "./apply";
import type { ConstraintSet } from "./types";
import { termLimitsFor } from "@/lib/rules/term-limits";
import { schoolOf } from "@/lib/schools";
import { continuingCourseCodes, takenCourseCodes } from "@/lib/solver/taken";

/**
 * A 介面的一輪（docs/CONVERSATION.md §1.3、§1.4）。
 *
 * 每輪必須回報三件事：改了什麼條件、課表差異、**代價**。
 * 第三點最重要 —— 只回新課表而不講代價，就跟一般的篩選器沒兩樣。
 *
 * 無解時不自動放寬（§1.4）：回報衝突原因並提出放寬建議，由使用者決定。
 */

export type PlanTurnOutcome = {
  solve: SolveResult;
  /** 1. 改了什麼條件 */
  changed: string[];
  /** 2. 課表差異 */
  diff: { added: string[]; removed: string[]; unchanged: boolean };
  /** 3. 代價 */
  costs: string[];
  /** 無解時提出的放寬選項，由使用者決定要不要用 */
  relaxOptions: string[];
  constraints: string[];
};

export function buildContext(
  audit: AuditResult,
  record: StudentRecord,
  pack: RulePack,
  set: ConstraintSet,
): SolveContext {
  const [year, term] = parseTerm(audit.nextTerm);
  const limits = termLimitsFor(pack, record.student, audit.nextTerm);
  return {
    offerings: offeringsFor(year, term, schoolOf(record.student), pack),
    requirements: requirementsFrom(audit),
    passedCodes: new Set(
      record.courses
        .filter((c) => c.status === "passed" || c.status === "waived")
        .map((c) => c.equivalentOf ?? c.code),
    ),
    takenCodes: takenCourseCodes(record.courses, pack),
    continueCodes: continuingCourseCodes(record.courses, pack),
    admissionYear: record.student.admissionYear,
    reserved: reservedFrom(record.plannedCommitments),
    preferences: {
      goal: set.goal,
      avoidEarly: set.avoidEarly,
      avoidDays: set.avoidDays,
      maxCredits: set.maxCredits,
      targetCourseCount: set.targetCourseCount,
      preferCompactDays: set.preferCompactDays,
      note: set.note,
      extraGoals: [],
    },
    constraints: toSolverConstraints(set, limits),
    termLabel: audit.nextTerm,
    termMinCredits: limits.minCredits,
    termMaxCredits: limits.maxCredits,
  };
}

export function runPlanTurn(
  ctx: SolveContext,
  set: ConstraintSet,
  before: Plan | undefined,
  changed: string[],
  /** 節次的說法依學校（輔大說 D1–D4，不說第 1–4 節） */
  names: PeriodNames = DEMO_PERIOD_NAMES,
): PlanTurnOutcome {
  // §1.4：對話中不自動放寬。solve() 走嚴格路徑，放寬只作為建議提出。
  const result = solve(ctx, PRESET_OF_GOAL[set.goal]);
  const after = result.ok ? result.plans[0] : undefined;

  const beforeMap = new Map((before?.courses ?? []).map((c) => [c.code, c.name]));
  const afterMap = new Map((after?.courses ?? []).map((c) => [c.code, c.name]));
  const added = [...afterMap].filter(([k]) => !beforeMap.has(k)).map(([k, v]) => `${v}（${k}）`);
  const removed = [...beforeMap].filter(([k]) => !afterMap.has(k)).map(([k, v]) => `${v}（${k}）`);

  return {
    solve: result,
    changed,
    diff: { added, removed, unchanged: added.length === 0 && removed.length === 0 },
    costs: computeCosts(ctx, before, after, result),
    relaxOptions: result.ok ? [] : relaxationOptions(set, result),
    constraints: describeSet(set, names),
  };
}

/**
 * 代價：這次調整換來了什麼、失去了什麼。
 *
 * 不是把 warnings 抄一遍，而是回答「你付出的成本是什麼」——
 * 選擇變少了幾門、餘額剩多少、學分變多變少、哪個偏好被犧牲。
 */
function computeCosts(
  ctx: SolveContext,
  before: Plan | undefined,
  after: Plan | undefined,
  result: SolveResult,
): string[] {
  const costs: string[] = [];
  if (!after) return costs;

  if (before && after.totalCredits !== before.totalCredits) {
    costs.push(
      `學分由 ${before.totalCredits} 變為 ${after.totalCredits}（${after.courses.length} 門）。`,
    );
  }

  // 每個未修需求現在還剩幾門可選 —— 選擇被壓縮到剩一兩門時，使用者應該知道
  if (result.ok) {
    const pool = result.excluded.candidatesBeforeFilter;
    const tight = ctx.requirements
      .map((r) => {
        const n = ctx.offerings.filter(
          (o) => o.category.includes(r.categoryId) && (!r.domain || o.generalDomain === r.domain),
        ).length;
        const usable = countUsable(ctx, r.categoryId, r.domain);
        return { label: r.shortLabel, n, usable };
      })
      .filter((x) => x.usable <= 2);
    for (const t of tight) {
      costs.push(
        t.usable === 0
          ? `${t.label} 已無可選開課（原本 ${t.n} 門）。`
          : `${t.label} 只剩 ${t.usable} 門可選（原本 ${t.n} 門）。`,
      );
    }
    void pool;
  }

  // 餘額未知（null）的不提醒 —— 沒有數字就不能說「只剩幾個」
  const lowSeat = after.courses.filter((c) => c.remaining !== null && c.remaining <= 5);
  for (const c of lowSeat) costs.push(`${c.name} 餘額只剩 ${c.remaining}，選上的把握不高。`);

  // 只列這一輪新出現的警告。上一版就已經存在的是**常駐狀態**，不是這次調整的代價 ——
  // 例如「期望 2 堂但下限要 3 堂」會在每一輪重印，使用者調時段時看到它只會困惑。
  // 本函式開頭的註解本來就寫「不是把 warnings 抄一遍」，先前的實作與之相反。
  const standing = new Set(before?.warnings ?? []);
  for (const w of after.warnings) if (!standing.has(w)) costs.push(w);

  return costs;
}

function countUsable(ctx: SolveContext, categoryId: string, domain?: string): number {
  const excluded = new Set(ctx.constraints.excludeCourses ?? []);
  return ctx.offerings.filter((o) => {
    if (!o.category.includes(categoryId)) return false;
    if (domain && o.generalDomain !== domain) return false;
    if (excluded.has(o.code)) return false;
    const seats = remainingSeats(o);
    if (seats !== null && seats <= 0) return false;
    const missing = o.prerequisites
      .filter((p) => p.confidence === "explicit")
      .flatMap((p) => p.codes)
      .filter((c) => !ctx.passedCodes.has(c));
    if (missing.length > 0) return false;
    if (o.slotsUnknown) return true;
    if (ctx.constraints.avoidDays?.some((d) => o.slots.some((s) => s.day === d))) return false;
    if (ctx.reserved.some((r) => r.slots.some((rs) => o.slots.some((os) => os.day === rs.day && os.periods.some((p) => rs.periods.includes(p)))))) {
      return false;
    }
    return true;
  }).length;
}

/**
 * §1.4 無解時提出放寬建議，但不自己套用。
 * 建議的順序與求解器的放寬順序一致，讓使用者知道哪一項最可能解開僵局。
 */
function relaxationOptions(set: ConstraintSet, result: Extract<SolveResult, { ok: false }>): string[] {
  const out: string[] = [];
  if (set.maxDays !== undefined) out.push(`解除「課排在 ${set.maxDays} 天內」`);
  if (set.avoidDays.length > 0) {
    out.push(`解除「空出星期${set.avoidDays.map((d) => "一二三四五六日"[d - 1]).join("、")}」`);
  }
  if (set.avoidPeriods.length > 0) out.push("解除指定要空出的節次");
  if (set.excludeCourses.length > 0) out.push("取消排除的課程");
  if (set.pinCourses.length > 0) out.push("取消指定保留的課程");
  if (set.maxCredits !== undefined) out.push(`放寬學分上限（目前 ${set.maxCredits}）`);
  if (set.avoidEarly) out.push("接受早八");
  for (const i of result.infeasibilities) {
    if (i.suggestion && !out.includes(i.suggestion)) out.push(i.suggestion);
  }
  return out.slice(0, 5);
}

/** §1.6 為什麼沒選某門課 */
export function explain(code: string, ctx: SolveContext, current: Plan | undefined) {
  return explainCourse(code, ctx, (current?.courses ?? []).map((c) => c.code));
}

function parseTerm(label: string): [number, 1 | 2] {
  const m = /^(\d+)-([12])$/.exec(label);
  if (!m) throw new Error(`學期代號格式錯誤：${label}`);
  return [Number(m[1]), Number(m[2]) as 1 | 2];
}
