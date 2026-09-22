import { DEFAULT_PREFERENCES, type Constraints, type CoursePreferences, type Offering } from "@/lib/types";
import { allOfferings } from "@/lib/offerings";
import type { ConstraintDelta, ConstraintSet } from "./types";
import type { PlanParams } from "./intent";

/**
 * 約束集合的建立與套用（docs/CONVERSATION.md §1.1）。
 *
 * 對話狀態是約束集合，不是訊息歷史。對話可以很長，但狀態永遠是這個小物件，
 * 不會因為歷史變長而漂移；使用者也能隨時看到目前的條件清單並直接編輯。
 */

/** 防呆：外部送進來的偏好可能缺欄位或帶非法值 */
export function preferencesOf(p: CoursePreferences | undefined): CoursePreferences {
  const base = p ?? DEFAULT_PREFERENCES;
  return {
    goal: ["asap", "balanced", "light"].includes(base.goal) ? base.goal : "balanced",
    avoidEarly: Boolean(base.avoidEarly),
    avoidDays: Array.isArray(base.avoidDays)
      ? [...new Set(base.avoidDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b)
      : [],
    maxCredits: clamp(base.maxCredits, 0, 30),
    targetCourseCount: clamp(base.targetCourseCount, 0, 10),
    preferCompactDays: Boolean(base.preferCompactDays),
    note: typeof base.note === "string" ? base.note.slice(0, 200) : undefined,
    extraGoals: Array.isArray(base.extraGoals) ? base.extraGoals.slice(0, 4) : [],
  };
}

function clamp(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;
}

export function constraintSetFrom(p: CoursePreferences): ConstraintSet {
  return {
    goal: p.goal,
    avoidEarly: p.avoidEarly,
    avoidDays: [...p.avoidDays],
    avoidPeriods: [],
    maxCredits: p.maxCredits,
    targetCourseCount: p.targetCourseCount,
    preferCompactDays: p.preferCompactDays,
    excludeCourses: [],
    pinCourses: [],
    goals: [],
    note: p.note,
  };
}

export function toSolverConstraints(
  c: ConstraintSet,
  termLimits: { maxCredits: number; minCredits: number },
): Constraints {
  return {
    avoidDays: c.avoidDays,
    avoidPeriods: c.avoidPeriods,
    avoidEarly: c.avoidEarly,
    maxCredits: Math.min(c.maxCredits ?? termLimits.maxCredits, termLimits.maxCredits),
    minCredits: termLimits.minCredits,
    targetCourseCount: c.targetCourseCount,
    preferCompactDays: c.preferCompactDays,
    excludeCourses: c.excludeCourses,
    pinCourses: c.pinCourses,
  };
}

export function preferencesOfSet(c: ConstraintSet): CoursePreferences {
  return {
    goal: c.goal,
    avoidEarly: c.avoidEarly,
    avoidDays: [...c.avoidDays],
    maxCredits: c.maxCredits,
    targetCourseCount: c.targetCourseCount,
    preferCompactDays: c.preferCompactDays,
    note: c.note,
    extraGoals: [],
  };
}

export type ApplyResult = {
  next: ConstraintSet;
  delta: ConstraintDelta;
  /** 課名查不到課號的項目，要向使用者說明而不是默默忽略 */
  unresolved: string[];
};

/**
 * 把 LLM 解析出的參數套用到目前的約束集合。
 *
 * 課名轉課號在這一步完成（§1.2）：使用者說「幫我加一門機器學習」，
 * 流程是查開課資料找到課號 → 放進 pinCourses → 重跑求解，
 * 而不是讓 LLM 直接把那門課寫進課表。
 */
export function applyParams(
  current: ConstraintSet,
  original: ConstraintSet,
  params: PlanParams,
  reason: string,
): ApplyResult {
  if (params.reset) {
    return {
      next: { ...original, avoidDays: [...original.avoidDays], avoidPeriods: [], excludeCourses: [], pinCourses: [], goals: [] },
      delta: { reason: "重設為個人資料的原始設定" },
      unresolved: [],
    };
  }

  const next: ConstraintSet = {
    ...current,
    avoidDays: [...current.avoidDays],
    avoidPeriods: [...current.avoidPeriods],
    excludeCourses: [...current.excludeCourses],
    pinCourses: [...current.pinCourses],
    goals: [...current.goals],
  };
  const delta: ConstraintDelta = { reason };
  const unresolved: string[] = [];

  if (params.avoidDays.length > 0) {
    const set = new Set([...next.avoidDays, ...params.avoidDays]);
    for (const d of params.allowDays) set.delete(d);
    next.avoidDays = [...set].sort((a, b) => a - b);
    delta.avoidDays = params.avoidDays;
  } else if (params.allowDays.length > 0) {
    next.avoidDays = next.avoidDays.filter((d) => !params.allowDays.includes(d));
  }

  if (params.avoidEarly !== null) next.avoidEarly = params.avoidEarly;
  if (params.preferCompactDays !== null) next.preferCompactDays = params.preferCompactDays;
  if (params.maxCredits !== null) {
    next.maxCredits = params.maxCredits;
    delta.maxCredits = params.maxCredits;
  }
  if (params.courseCountTarget !== null) next.targetCourseCount = params.courseCountTarget;
  else if (params.courseCountDelta !== null) {
    next.targetCourseCount = Math.max(0, (current.targetCourseCount ?? 0) + params.courseCountDelta);
  }
  if (params.goal !== null) next.goal = params.goal;
  if (params.goals.length > 0) {
    next.goals = [...new Set([...next.goals, ...params.goals])];
    delta.goals = params.goals;
    // 「提前畢業」在求解層面就是把目標換成最快畢業
    if (params.goals.includes("early-graduation")) next.goal = "asap";
  }

  const offerings = allOfferings();
  const resolve = (name: string): string | null => {
    const q = name.replace(/\s/g, "");
    const byCode = offerings.find((o) => o.code.toUpperCase() === q.toUpperCase());
    if (byCode) return byCode.code;
    const byName = offerings.filter((o) => o.name.includes(q) || q.includes(o.name));
    return byName.length === 1 ? byName[0]!.code : null;
  };

  for (const raw of params.excludeCourses) {
    const code = resolve(raw);
    if (!code) {
      unresolved.push(raw);
      continue;
    }
    if (!next.excludeCourses.includes(code)) next.excludeCourses.push(code);
    next.pinCourses = next.pinCourses.filter((c) => c !== code);
  }
  for (const raw of params.pinCourses) {
    const code = resolve(raw);
    if (!code) {
      unresolved.push(raw);
      continue;
    }
    if (!next.pinCourses.includes(code)) next.pinCourses.push(code);
    next.excludeCourses = next.excludeCourses.filter((c) => c !== code);
  }
  if (next.excludeCourses.length > 0) delta.excludeCourses = next.excludeCourses;
  if (next.pinCourses.length > 0) delta.pinCourses = next.pinCourses;

  return { next, delta, unresolved };
}

/** 把約束集合寫成人看得懂的條件清單，UI 與回覆共用同一份 */
export function describeSet(c: ConstraintSet): string[] {
  const out: string[] = [];
  out.push({ asap: "以最快畢業為目標", balanced: "維持正常修課進度", light: "這學期修少一點" }[c.goal]);
  if (c.avoidEarly) out.push("不排早八（第 1 節）");
  if (c.avoidDays.length > 0) out.push(`空出星期${c.avoidDays.map((d) => "一二三四五六日"[d - 1]).join("、")}`);
  for (const a of c.avoidPeriods) {
    out.push(`空出星期${"一二三四五六日"[a.day - 1]} 第 ${a.periods.join("、")} 節`);
  }
  if (c.targetCourseCount !== undefined) out.push(`期望 ${c.targetCourseCount} 堂課`);
  if (c.preferCompactDays) out.push("課程盡量集中在少數幾天");
  if (c.maxCredits !== undefined) out.push(`學期學分上限 ${c.maxCredits}`);
  for (const code of c.pinCourses) out.push(`保留 ${nameOf(code)}`);
  for (const code of c.excludeCourses) out.push(`排除 ${nameOf(code)}`);
  if (c.goals.includes("minor")) out.push("另有輔系需求（尚未收錄規定）");
  if (c.goals.includes("cert-program")) out.push("另有學程需求（尚未收錄規定）");
  return out;
}

function nameOf(code: string): string {
  const o: Offering | undefined = allOfferings().find((x) => x.code === code);
  return o ? `${o.name}（${code}）` : code;
}
