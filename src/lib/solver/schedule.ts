import type { OptionalPreferences } from "@/lib/ui/prefs";
import type {
  AuditResult,
  Constraints,
  CoursePreferences,
  ExclusionReason,
  ExclusionSummary,
  Infeasibility,
  Offering,
  Plan,
  PlanCourse,
  Preset,
  SolveResult,
  TimeSlot,
} from "@/lib/types";
import { clashes, formatSlots, isEarlyMorning, parseSlots } from "./slots";
import { cmp } from "@/lib/util/text";

/**
 * 選課組合求解（BACKEND.md §5）。
 *
 * 純確定性 backtracking，不得呼叫 LLM（CI 會掃描本檔的 import）。
 * preset 是不同的目標函數，不是不同演算法。
 */

// ------------------------------------------------------------------ 需求

export type Requirement = {
  id: string;
  /** 完整敘述，用於求解條件說明與無解回報 */
  label: string;
  /** 表格用的精簡標籤，如「通識涵養課程·自然科技領域」 */
  shortLabel: string;
  categoryId: string;
  /** 未修學分 */
  minCredits: number;
  /** 領域限制（通識四大領域） */
  domain?: string;
  /** 領域至少一門 */
  minCourses?: number;
};

/** 領域未達時的權重：以 2 學分等值計入目標函數，與一門通識課的學分數同量級 */
const DOMAIN_WEIGHT = 2;

export function requirementsFrom(audit: AuditResult): Requirement[] {
  const reqs: Requirement[] = [];
  for (const cat of audit.categories) {
    if (cat.unmet > 0) {
      reqs.push({
        id: `${cat.id}:credits`,
        label: `${cat.name} ${cat.unmet} 學分`,
        shortLabel: cat.name,
        categoryId: cat.id,
        minCredits: cat.unmet,
      });
    }
    for (const sub of cat.subRules) {
      if (sub.status !== "unmet" || !sub.items) continue;
      for (const item of sub.items.filter((i) => !i.ok && !i.note)) {
        reqs.push({
          id: `${cat.id}:domain:${item.label}`,
          label: `${cat.name}·${item.label}領域 至少 1 門`,
          shortLabel: `${cat.name}·${item.label}`,
          categoryId: cat.id,
          domain: item.label,
          minCredits: 0,
          minCourses: 1,
        });
      }
    }
  }
  return reqs;
}

// ------------------------------------------------------------------ 過濾

type Candidate = {
  offering: Offering;
  remaining: number;
  /** 本課程可滿足哪些需求 */
  satisfies: string[];
  early: boolean;
  prereqWarning?: string;
  slotUnknownNote?: boolean;
  /** 使用者指定一定要留的課，任何解都必須包含 */
  pinned: boolean;
};

export type SolveContext = {
  offerings: Offering[];
  requirements: Requirement[];
  /** 已及格／抵免之課號，供 explicit 先修判定 */
  passedCodes: Set<string>;
  reserved: { label: string; slots: TimeSlot[] }[];
  constraints: Constraints;
  termLabel: string;
  termMinCredits: number;
  termMaxCredits: number;
  /** 學生於基本資料填寫的選課傾向；第一版課表即依此產生 */
  preferences: CoursePreferences;
  /**
   * 選填偏好。只在兩份課表於所有規劃條件上完全相同時，用來決定誰排前面 ——
   * 不填、填錯、填了系統看不懂的詞，課表的可行性與判定都不會改變。
   */
  optional?: OptionalPreferences;
};

/**
 * 選課傾向 → 求解條件。
 *
 * 傾向與硬限制分開：avoidDays 是硬限制（那幾天完全空出來），
 * avoidEarly 與 targetCourseCount 是偏好，只影響排序 ——
 * 把偏好做成硬限制，會讓「不要早八」在唯一開課就是早八時變成無解，
 * 而正確的回答是「只剩早八這一門，你自己決定」。
 */
export function constraintsFrom(
  prefs: CoursePreferences,
  termLimits: { maxCredits: number; minCredits: number },
): Constraints {
  return {
    avoidDays: prefs.avoidDays,
    avoidEarly: prefs.avoidEarly,
    maxCredits: Math.min(prefs.maxCredits ?? termLimits.maxCredits, termLimits.maxCredits),
    minCredits: termLimits.minCredits,
    targetCourseCount: prefs.targetCourseCount,
    preferCompactDays: prefs.preferCompactDays,
  };
}

/** 目標對應到 SPEC §8 的 preset 代號，讓 API 契約維持不變 */
export const PRESET_OF_GOAL: Record<CoursePreferences["goal"], Preset> = {
  asap: "fill-unmet",
  balanced: "fill-unmet",
  light: "fewest-courses",
};

/** 把生效條件寫成人看得懂的句子，UI 與 trace 都用這一份 */
export function describeConstraints(c: Constraints, prefs: CoursePreferences): string[] {
  const out: string[] = [];
  out.push(
    { asap: "以最快畢業為目標", balanced: "維持正常修課進度", light: "這學期修少一點" }[prefs.goal],
  );
  if (c.avoidEarly) out.push("不排早八（第 1 節）");
  if (c.avoidDays?.length) out.push(`空出星期${c.avoidDays.map((d) => DAY_NAME[d] ?? d).join("、")}`);
  if (c.targetCourseCount) out.push(`期望 ${c.targetCourseCount} 堂課`);
  if (c.preferCompactDays) out.push("課程盡量集中在少數幾天");
  if (c.maxCredits !== undefined) out.push(`學期學分上限 ${c.maxCredits}`);
  return out;
}

const DAY_NAME: Record<number, string> = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "日" };

type Exclusion = { reason: string; code: string; name: string; step: ExclusionReason["step"] };

const MAX_COURSES = 6;
const NODE_LIMIT = 300_000;

/**
 * 候選過濾。
 *
 * 分兩類：
 *   candidates —— 能補足未修學分的課
 *   fillers    —— 補不到未修學分，但學生仍可修、可用來湊足**學期學分下限**的課
 *
 * 學則的學期學分下限是硬規定，不是偏好：交出一份 6 學分的課表再附一句
 * 「低於下限」，等於要學生自己去想辦法，那不是建議，是把問題丟回去。
 */
function filterCandidates(ctx: SolveContext): {
  candidates: Candidate[];
  fillers: Candidate[];
  exclusions: Exclusion[];
} {
  const exclusions: Exclusion[] = [];
  const candidates: Candidate[] = [];
  const fillers: Candidate[] = [];
  const relevantCats = new Set(ctx.requirements.map((r) => r.categoryId));

  const excluded = new Set(ctx.constraints.excludeCourses ?? []);
  const pinned = new Set(ctx.constraints.pinCourses ?? []);

  for (const o of [...ctx.offerings].sort((a, b) => cmp(a.code, b.code))) {
    const drop = (step: ExclusionReason["step"], reason: string) =>
      exclusions.push({ reason, code: o.code, name: o.name, step });

    // 0. 使用者明講不要的課
    if (excluded.has(o.code)) {
      drop("excluded-by-user", "你指定不要這門課");
      continue;
    }

    // 1. 類別符合。不符合的不是「排除」，而是降級為湊學分下限用的候選
    const satisfies = o.category.some((c) => relevantCats.has(c))
      ? ctx.requirements
          .filter((r) => o.category.includes(r.categoryId) && (!r.domain || o.generalDomain === r.domain))
          .map((r) => r.id)
      : [];

    // 2. 先修已修畢（僅 explicit 當硬限制）
    const explicit = o.prerequisites.filter((p) => p.confidence === "explicit");
    const missing = explicit.flatMap((p) => p.codes).filter((c) => !ctx.passedCodes.has(c));
    if (missing.length > 0) {
      drop("prerequisite", `先修科目未修畢（${missing.join("、")}）`);
      continue;
    }

    // 3. 餘額 > 0
    const remaining = Math.max(0, o.capacity - o.enrolled);
    if (remaining <= 0) {
      drop("no-seat", "修課餘額為 0");
      continue;
    }

    // 4. 不與已排定時段衝突（時段未知者無法判定，保留並標記）
    if (!o.slotsUnknown) {
      const hit = ctx.reserved.find((r) => clashes(o.slots, r.slots));
      if (hit) {
        drop("clash-reserved", `與已登記時段衝突（${hit.label}）`);
        continue;
      }
      if (ctx.constraints.avoidDays?.some((d) => o.slots.some((s) => s.day === d))) {
        drop("avoid-day", "落在你指定要空出的星期");
        continue;
      }
      const period = (ctx.constraints.avoidPeriods ?? []).find((a) =>
        clashes(o.slots, [{ day: a.day as TimeSlot["day"], periods: a.periods }]),
      );
      if (period) {
        drop("avoid-period", `落在你指定要空出的節次（星期${DAY_NAME[period.day]} ${period.periods.join("、")}）`);
        continue;
      }
    }

    // extracted 先修：只提示，不排除（低信心抽取不得造成無聲的錯誤建議）
    const soft = o.prerequisites.find((p) => p.confidence !== "explicit" && p.sourceText);
    const c: Candidate = {
      offering: o,
      remaining,
      satisfies,
      early: !o.slotsUnknown && isEarlyMorning(o.slots),
      prereqWarning: soft?.sourceText,
      slotUnknownNote: o.slotsUnknown,
      pinned: pinned.has(o.code),
    };
    if (satisfies.length > 0 || c.pinned) candidates.push(c);
    else fillers.push(c);
  }

  return { candidates, fillers, exclusions };
}

/** 湊學分下限的候選不需要全部進搜尋空間，取學分數較大的幾門即可 */
const FILLER_LIMIT = 8;

function summarize(exclusions: Exclusion[], before: number): ExclusionSummary {
  const byReason = new Map<string, Exclusion[]>();
  for (const e of exclusions) {
    const key = e.reason.replace(/（.*）$/, "");
    byReason.set(key, [...(byReason.get(key) ?? []), e]);
  }
  return {
    candidatesBeforeFilter: before,
    excludedBy: [...byReason.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([reason, list]) => ({
        reason,
        count: list.length,
        examples: list.slice(0, 3).map((e) => `${e.name}（${e.code}）`),
      })),
  };
}

// ------------------------------------------------------------------ 評分

type Score = {
  unmetAfter: number;
  courseCount: number;
  earlyMorningCount: number;
  belowTermMin: number;
  totalCredits: number;
  /** 佔用的上課天數；preferCompactDays 用 */
  dayCount: number;
  /** 與期望堂數的差距 */
  countGap: number;
  /** 選填偏好的契合度。**只用於完全平手時的排序**，不進入目標函數 */
  affinity: number;
  /** 決勝用：課號串接，確保排序完全確定 */
  key: string;
};

function shortfall(sel: Candidate[], reqs: Requirement[]): number {
  let s = 0;
  for (const r of reqs) {
    const hit = sel.filter((c) => c.satisfies.includes(r.id));
    const credits = hit.reduce((a, c) => a + c.offering.credits, 0);
    s += Math.max(0, r.minCredits - credits);
    if (r.minCourses && hit.length < r.minCourses) s += DOMAIN_WEIGHT;
  }
  return s;
}

function score(sel: Candidate[], ctx: SolveContext): Score {
  const totalCredits = sel.reduce((a, c) => a + c.offering.credits, 0);
  const days = new Set<number>();
  for (const c of sel) for (const s of c.offering.slots) days.add(s.day);
  const target = ctx.constraints.targetCourseCount;
  return {
    unmetAfter: shortfall(sel, ctx.requirements),
    courseCount: sel.length,
    earlyMorningCount: sel.filter((c) => c.early).length,
    belowTermMin: Math.max(0, ctx.termMinCredits - totalCredits),
    totalCredits,
    dayCount: days.size,
    countGap: target ? Math.abs(sel.length - target) : 0,
    affinity: sel.reduce((a, c) => a + affinityOf(c.offering, ctx.optional), 0),
    key: sel.map((c) => c.offering.code).sort(cmp).join(","),
  };
}

/**
 * 選填偏好對單一課程的契合度。
 *
 * **這個數字只用來排序，不進入目標函數、不影響可行性。**
 * 它在排序鍵裡排在所有規劃條件之後、確定性 tie-break 之前 ——
 * 也就是說，只有在兩份課表於「未修學分、堂數、早八、集中度、學期下限」
 * 全部相同時，它才會決定誰排前面。這正是畫面上那句
 * 「不填不影響審查結果與課表可行性，僅影響課程排序」的實作保證。
 *
 * 比對方式是單純的關鍵詞出現與否（課名、通識領域），不是語意比對，也沒有 LLM。
 * 選填欄位是使用者自填的自由文字，用相似度去猜會讓排序變得無法解釋。
 */
function affinityOf(o: Offering, opt: OptionalPreferences | undefined): number {
  if (!opt) return 0;
  const hay = `${o.name}${o.generalDomain ?? ""}`;
  let n = 0;
  for (const k of opt.interestAreas) if (k && hay.includes(k)) n += 1;
  if (opt.careerDirection && hay.includes(opt.careerDirection)) n += 1;
  for (const k of opt.avoidCourseTypes) if (k && hay.includes(k)) n -= 1;
  return n;
}

/**
 * 目標函數由選課傾向組出來，而不是三選一的固定 preset。
 *
 * 共同的第一順位永遠是「補足未修」（呼叫端已先把候選限縮到最小未修），
 * 其後才依傾向排序。avoidEarly 之所以放在偏好層而非硬限制，
 * 是因為唯一開課就是早八時，正確的行為是照排並標示，而不是回報無解。
 */
function objectiveFor(ctx: SolveContext): (s: Score) => number[] {
  const p = ctx.preferences;
  const early = (s: Score) => (ctx.constraints.avoidEarly ? s.earlyMorningCount : 0);
  const compact = (s: Score) => (ctx.constraints.preferCompactDays ? s.dayCount : 0);
  // 使用者明講過堂數時，這一項在每個目標下都排在前面 ——
  // 「少一堂課」就是少一堂課，不該因為目標是「最快畢業」而被無視
  const gap = (s: Score) => (ctx.constraints.targetCourseCount !== undefined ? s.countGap : 0);

  switch (p.goal) {
    // 最快畢業：補滿未修後盡量多修，並湊到學期下限
    case "asap":
      return (s) => [s.unmetAfter, gap(s), s.belowTermMin, early(s), -s.totalCredits, compact(s), s.courseCount];
    // 這學期輕一點：堂數優先，其次才是早八與集中度
    case "light":
      return (s) => [s.unmetAfter, s.courseCount, gap(s), early(s), compact(s), s.totalCredits];
    // 正常進度：先滿足時段偏好與期望堂數，再考慮學分下限
    case "balanced":
    default:
      return (s) => [s.unmetAfter, early(s), gap(s), compact(s), s.belowTermMin, s.courseCount];
  }
}

const PRESET_LABEL: Record<Preset, string> = {
  "fill-unmet": "補足未修",
  "no-early": "避開早八",
  "fewest-courses": "最少堂數",
};

const GOAL_LABEL: Record<CoursePreferences["goal"], string> = {
  asap: "最快畢業",
  balanced: "正常進度",
  light: "輕量修課",
};

function lexCompare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ------------------------------------------------------------------ 求解

/**
 * 嚴格求解：**不自動放寬**使用者設定的條件（CONVERSATION.md §1.4）。
 *
 * 對話中每一輪都走這條路徑。補不完未修學分時仍回傳最佳的部分方案並在 warnings 說明，
 * 但絕不偷偷解除使用者指定的條件再交出一份看起來可行的課表 ——
 * 放寬與否是使用者的決定，系統只負責把選項攤出來。
 */
export function solve(ctx: SolveContext, preset?: Preset): SolveResult {
  return attemptSolve(ctx, preset ?? PRESET_OF_GOAL[ctx.preferences.goal], [], true);
}

/**
 * 無解時自動重試一次，放寬順序：maxCredits → avoidDays → 允許 extracted 先修未過但標示風險。
 * 放寬了什麼一定要寫在 trace 與 UI 上。
 *
 * 「補不完未修學分」也算無解：交出一份執行完仍然畢不了業的課表，
 * 比誠實說「這些條件湊不出解」更容易誤導人。因此先走放寬流程，
 * 全部放寬過仍補不完時，才回傳最佳的部分方案並明確標示。
 */
export function solveWithRelaxation(ctx: SolveContext, preset: Preset, relaxations: string[]): SolveResult {
  const strict = attemptSolve(ctx, preset, relaxations, false);
  if (strict.ok) return strict;

  if (relaxations.length === 0) {
    const next = relaxOnce(ctx);
    if (next) {
      const retried = solveWithRelaxation(next.ctx, preset, next.applied);
      if (retried.ok) return retried;
      relaxations = next.applied;
      ctx = next.ctx;
    }
  }

  const partial = attemptSolve(
    ctx,
    preset,
    [...relaxations, "已放寬至可行範圍，仍無法於本學期補足全部未修學分"],
    true,
  );
  return partial.ok ? partial : strict;
}

/** extracted 先修本來就不是硬限制，因此第三順位改為放寬「避開早八」 */
function relaxOnce(ctx: SolveContext): { ctx: SolveContext; applied: string[] } | null {
  const c = ctx.constraints;
  if (c.maxCredits && c.maxCredits < ctx.termMaxCredits) {
    return {
      ctx: { ...ctx, constraints: { ...c, maxCredits: ctx.termMaxCredits } },
      applied: [`學期學分上限自 ${c.maxCredits} 放寬至 ${ctx.termMaxCredits}`],
    };
  }
  if (c.avoidDays?.length) {
    return {
      ctx: { ...ctx, constraints: { ...c, avoidDays: [] } },
      applied: [`取消「避開星期 ${c.avoidDays.join("、")}」的限制`],
    };
  }
  if (c.avoidEarly) {
    return {
      ctx: { ...ctx, constraints: { ...c, avoidEarly: false } },
      applied: ["取消「避開早八」的限制"],
    };
  }
  return null;
}

function attemptSolve(
  ctx: SolveContext,
  preset: Preset,
  relaxations: string[],
  allowPartial: boolean,
): SolveResult {
  const { candidates, fillers, exclusions } = filterCandidates(ctx);
  const excluded = summarize(exclusions, ctx.offerings.length);

  // 2. 任一 unmet 類別的候選集為空 → 立即回報 infeasible，附原因
  const empty = ctx.requirements.filter((r) => !candidates.some((c) => c.satisfies.includes(r.id)));
  if (empty.length > 0) {
    return {
      ok: false,
      infeasibilities: empty.map((r) => buildInfeasibility(r, ctx, exclusions)),
      excluded,
      relaxations,
    };
  }

  const maxCredits = ctx.constraints.maxCredits ?? ctx.termMaxCredits;

  // 使用者指定一定要留的課：任何解都必須包含。
  // 指定了卻不在候選集裡，代表它被前面某個過濾步驟擋掉了 —— 那是無解，而且要說得出是哪一步。
  const wantPinned = new Set(ctx.constraints.pinCourses ?? []);
  const pinnedCandidates = candidates.filter((c) => c.pinned);
  const missingPinned = [...wantPinned].filter((code) => !pinnedCandidates.some((c) => c.offering.code === code));
  if (missingPinned.length > 0) {
    return {
      ok: false,
      infeasibilities: missingPinned.map((code) => pinnedInfeasibility(code, ctx, exclusions)),
      excluded,
      relaxations,
    };
  }
  const pinnedCredits = pinnedCandidates.reduce((a, c) => a + c.offering.credits, 0);
  const pinnedClash = pinnedCandidates.find((a, i) =>
    pinnedCandidates.some(
      (b, j) =>
        i < j &&
        !a.offering.slotsUnknown &&
        !b.offering.slotsUnknown &&
        clashes(a.offering.slots, b.offering.slots),
    ),
  );
  if (pinnedClash) {
    return {
      ok: false,
      infeasibilities: [
        {
          category: "指定保留的課程",
          candidatesBeforeFilter: pinnedCandidates.length,
          excludedBy: [],
          conflictWith: pinnedClash.offering.name,
          suggestion: `你指定保留的課程之間有衝堂（含「${pinnedClash.offering.name}」），請先取消其中一門。`,
        },
      ],
      excluded,
      relaxations,
    };
  }

  // 3. backtracking：課程依學分降冪嘗試（pinned 不進搜尋空間，永遠在解裡）
  const usableFillers = [...fillers]
    .sort((a, b) => b.offering.credits - a.offering.credits || cmp(a.offering.code, b.offering.code))
    .slice(0, FILLER_LIMIT);
  const sorted = [...candidates.filter((c) => !c.pinned), ...usableFillers].sort(
    (a, b) => b.offering.credits - a.offering.credits || cmp(a.offering.code, b.offering.code),
  );
  const suffix = new Array<number>(sorted.length + 1).fill(0);
  for (let i = sorted.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + sorted[i]!.offering.credits;

  const solutions: { sel: Candidate[]; score: Score }[] = [];
  const sel: Candidate[] = [...pinnedCandidates];
  let nodes = 0;
  let truncated = false;

  const dfs = (i: number, credits: number): void => {
    if (truncated) return;
    if (++nodes > NODE_LIMIT) {
      truncated = true;
      return;
    }
    if (sel.length > 0 && isIrredundant(sel, ctx, pinnedCandidates.length)) {
      solutions.push({ sel: [...sel], score: score(sel, ctx) });
    }
    if (i >= sorted.length || sel.length >= MAX_COURSES) return;

    // 剪枝：剩餘候選可提供學分 < 尚缺學分
    if (shortfall(sel, ctx.requirements) > suffix[i]! + DOMAIN_WEIGHT * ctx.requirements.length) return;

    for (let j = i; j < sorted.length; j++) {
      const c = sorted[j]!;
      // 剪枝：已選學分 > maxCredits
      if (credits + c.offering.credits > maxCredits) continue;
      if (sel.some((s) => !s.offering.slotsUnknown && !c.offering.slotsUnknown && clashes(s.offering.slots, c.offering.slots))) {
        continue;
      }
      sel.push(c);
      dfs(j + 1, credits + c.offering.credits);
      sel.pop();
      if (truncated) return;
    }
  };

  dfs(0, pinnedCredits);

  if (solutions.length === 0) {
    return {
      ok: false,
      infeasibilities: ctx.requirements.map((r) => buildInfeasibility(r, ctx, exclusions)),
      excluded,
      relaxations,
    };
  }

  // 4. 依 preset 排序取前 3 組
  //
  // 先把候選限縮到「能達到的最小未修學分」那一群，再套 preset 的目標函數。
  // 少了這一步，fewest-courses 會挑出一門課就交差、卻留著未修學分的方案 ——
  // 那在畢業審查的場域不是一個「比較少堂數的選擇」，而是一份錯的建議。
  const bestUnmet = Math.min(...solutions.map((s) => s.score.unmetAfter));
  if (bestUnmet > 0 && !allowPartial) {
    return {
      ok: false,
      infeasibilities: ctx.requirements.map((r) => buildInfeasibility(r, ctx, exclusions)),
      excluded,
      relaxations,
    };
  }
  let complete = solutions.filter((s) => s.score.unmetAfter === bestUnmet);

  // 學期學分下限是學則的硬規定。只要湊得到，就一律交出達標的課表；
  // 真的湊不到（開課不夠）才退而求其次，並在 warnings 說明。
  const reachesMin = complete.filter((s) => s.score.belowTermMin === 0);
  if (reachesMin.length > 0) complete = reachesMin;

  const obj = objectiveFor(ctx);
  const ranked = complete
    .sort(
      (a, b) =>
        // 規劃條件永遠優先；契合度只在完全平手時才決定順序
        lexCompare(obj(a.score), obj(b.score)) ||
        b.score.affinity - a.score.affinity ||
        cmp(a.score.key, b.score.key),
    )
    .filter((s, i, arr) => i === 0 || s.score.key !== arr[i - 1]!.score.key);

  const plans: Plan[] = ranked.slice(0, 3).map((s, i) => toPlan(s.sel, s.score, preset, ctx, i, relaxations));
  if (truncated) {
    for (const p of plans) p.relaxations = [...p.relaxations, "搜尋空間過大，已於節點上限處截斷，結果為可行解而非保證最佳解"];
  }
  return { ok: true, plans, excluded, relaxations };
}

/**
 * 可有可無的課要拿掉：移除任一門後 (未修, 低於下限) 都不變差，就代表這門是贅餘的。
 * 使用者指定保留的課不在檢查範圍內 —— 它們留在解裡是命令，不是最佳化的結果。
 */
function isIrredundant(sel: Candidate[], ctx: SolveContext, pinnedCount: number): boolean {
  const base = score(sel, ctx);
  for (let i = pinnedCount; i < sel.length; i++) {
    const without = sel.filter((_, j) => j !== i);
    const s = score(without, ctx);
    if (s.unmetAfter <= base.unmetAfter && s.belowTermMin <= base.belowTermMin) return false;
  }
  return true;
}

function toPlan(
  sel: Candidate[],
  s: Score,
  preset: Preset,
  ctx: SolveContext,
  idx: number,
  relaxations: string[],
): Plan {
  const ordered = [...sel].sort((a, b) => cmp(a.offering.code, b.offering.code));
  const warnings: string[] = [];
  if (s.belowTermMin > 0) {
    warnings.push(
      `合計 ${s.totalCredits} 學分，未達學則的學期學分下限 ${ctx.termMinCredits} 學分 —— ` +
        `${ctx.termLabel} 可選的開課不足以湊到下限。請洽系辦確認是否可專案申請低於下限修課。`,
    );
  }
  if (s.unmetAfter > 0) {
    warnings.push(`本方案執行後仍有未修學分，無法於 ${ctx.termLabel} 補齊。`);
  }
  if (ordered.some((c) => c.offering.slotsUnknown)) {
    warnings.push("含時段未知之課程，衝堂判定未涵蓋該門。");
  }
  if (ctx.constraints.avoidEarly && s.earlyMorningCount > 0) {
    warnings.push(
      `你設定了不排早八，但符合未修類別的開課中只有早八時段可選，本方案仍含 ${s.earlyMorningCount} 門早八課。`,
    );
  }
  if (ctx.constraints.targetCourseCount && s.countGap > 0) {
    const why =
      s.unmetAfter === 0 && s.belowTermMin === 0
        ? `要同時補足未修學分並達到學則的學期學分下限 ${ctx.termMinCredits}`
        : "要補足未修學分";
    warnings.push(
      `你期望 ${ctx.constraints.targetCourseCount} 堂課，但${why}，至少需要 ${s.courseCount} 堂。`,
    );
  }
  return {
    id: `${preset}-${idx + 1}`,
    preset,
    label: idx === 0 ? `依你的選課傾向（${GOAL_LABEL[ctx.preferences.goal]}）` : `替代方案 ${idx}`,
    appliedConstraints: describeConstraints(ctx.constraints, ctx.preferences),
    term: ctx.termLabel,
    totalCredits: s.totalCredits,
    unmetAfter: s.unmetAfter,
    relaxations: [...relaxations],
    warnings,
    courses: ordered.map((c) => toPlanCourse(c, ctx)),
  };
}

function toPlanCourse(c: Candidate, ctx: SolveContext): PlanCourse {
  const req = ctx.requirements.find((r) => c.satisfies.includes(r.id));
  return {
    code: c.offering.code,
    name: c.offering.name,
    credits: c.offering.credits,
    slotText: c.offering.slotsUnknown
      ? `時段未知（原始：${c.offering.rawSlotText ?? "—"}）`
      : (c.offering.rawSlotText ?? formatSlots(c.offering.slots)),
    slots: c.offering.slotsUnknown ? [] : c.offering.slots,
    teacher: c.offering.teacher,
    category: req?.categoryId ?? c.offering.category[0]!,
    categoryLabel: req?.shortLabel ?? c.offering.category[0]!,
    remaining: c.remaining,
    prereqWarning: c.prereqWarning,
  };
}

/** 無解回報：UI 上「哪兩個條件在打架」的來源 */
function buildInfeasibility(req: Requirement, ctx: SolveContext, exclusions: Exclusion[]): Infeasibility {
  const catOfferings = ctx.offerings.filter(
    (o) => o.category.includes(req.categoryId) && (!req.domain || o.generalDomain === req.domain),
  );
  const codes = new Set(catOfferings.map((o) => o.code));
  const mine = exclusions.filter((e) => codes.has(e.code));

  const byReason = new Map<string, Exclusion[]>();
  for (const e of mine) {
    const key = e.reason.replace(/（.*）$/, "");
    byReason.set(key, [...(byReason.get(key) ?? []), e]);
  }

  const clashHit = mine.find((e) => e.reason.startsWith("與已登記時段衝突"));
  const conflictWith = clashHit
    ? ctx.reserved.find((r) => clashHit.reason.includes(r.label))
    : undefined;

  const suggestion = clashHit
    ? `本類別開課全數與「${conflictWith?.label ?? "已登記時段"}」重疊；可考慮調整該時段，或確認是否開設暑修班。`
    : mine.some((e) => e.reason === "修課餘額為 0")
      ? "本類別開課已全數額滿，可考慮加簽或改選其他學期。"
      : mine.some((e) => e.reason.startsWith("先修科目未修畢"))
        ? "本類別開課皆有先修限制，須先補修先修科目。"
        : `${ctx.termLabel} 查無符合本類別之開課，請洽系辦確認是否另行加開。`;

  return {
    category: req.label,
    candidatesBeforeFilter: catOfferings.length,
    excludedBy: [...byReason.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([reason, list]) => ({
        reason,
        count: list.length,
        examples: list.slice(0, 3).map((e) => `${e.name}（${e.code}）`),
      })),
    conflictWith: conflictWith
      ? `${conflictWith.label} ${formatSlots(conflictWith.slots)}`
      : undefined,
    suggestion,
  };
}

/** 指定保留的課排不進來時，要說得出是哪一步擋掉的（§1.6） */
function pinnedInfeasibility(code: string, ctx: SolveContext, exclusions: Exclusion[]): Infeasibility {
  const hit = exclusions.find((e) => e.code === code);
  const offering = ctx.offerings.find((o) => o.code === code);
  return {
    category: `指定保留：${offering?.name ?? code}`,
    candidatesBeforeFilter: offering ? 1 : 0,
    excludedBy: hit ? [{ reason: hit.reason, count: 1, examples: [`${hit.name}（${hit.code}）`] }] : [],
    suggestion: offering
      ? `「${offering.name}」因${hit?.reason ?? "不在可選範圍"}而無法排入。取消保留或先處理該原因後再試。`
      : `${ctx.termLabel} 查無課號 ${code} 的開課資料。`,
  };
}

/**
 * 某一門課為什麼沒被排進來（CONVERSATION.md §1.6）。
 * 依序回答：沒開課／類別不需要／擋修／額滿／衝堂／被你排除／有資格但沒被選上。
 */
export function explainCourse(query: string, ctx: SolveContext, chosen: string[]): ExclusionReason {
  // 使用者可能給課號，也可能給課名 —— 兩種都要查得到
  const q = query.replace(/\s/g, "");
  const offering =
    ctx.offerings.find((o) => o.code.toUpperCase() === q.toUpperCase()) ??
    ctx.offerings.find((o) => o.name === q) ??
    ctx.offerings.find((o) => o.name.includes(q) || q.includes(o.name));

  if (!offering) {
    return {
      code: q,
      name: q,
      step: "not-offered",
      detail: `${ctx.termLabel} 的開課資料中查無「${query}」。`,
    };
  }
  const code = offering.code;
  if (chosen.includes(code)) {
    return {
      code,
      name: offering.name,
      step: "chosen",
      detail: `這門課已經在目前的建議課表裡（${offering.slotsUnknown ? "時段未知" : (offering.rawSlotText ?? formatSlots(offering.slots))}，${offering.credits} 學分）。`,
    };
  }
  const { exclusions } = filterCandidates(ctx);
  const hit = exclusions.find((e) => e.code === code);
  if (hit) return { code, name: offering.name, step: hit.step, detail: hit.reason };
  return {
    code,
    name: offering.name,
    step: "not-chosen",
    detail:
      "這門課通過了所有過濾條件，但在目前的目標下沒有被選上 —— " +
      "求解器挑的是能補足未修學分又最符合你條件的組合，並非把所有可選課程都排進去。",
  };
}

/** 將 StudentRecord 的已登記時段轉為求解器可用的形狀 */
export function reservedFrom(commitments: { label: string; slotText: string }[] | undefined): {
  label: string;
  slots: TimeSlot[];
}[] {
  return (commitments ?? []).map((c) => ({ label: c.label, slots: parseSlots(c.slotText).slots }));
}
