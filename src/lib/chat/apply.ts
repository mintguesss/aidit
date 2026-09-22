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

/**
 * 「早上」＝第 1–4 節（第 5 節 13:20 已是下午，見 lib/offerings/periods.ts），週一至週五。
 *
 * 這與「早八」是兩件不同的事，不得互相代用：
 *   - avoidEarly 只涵蓋第 1 節，而且是**軟**偏好 —— 唯一開課就是早八時照排並標示，
 *     正確的回答是「只剩早八這一門，你自己決定」而不是回報無解（schedule.ts §排除）。
 *   - 不排早上是使用者明確畫掉一段時間，走 avoidPeriods，是**硬**限制；
 *     排不出來時由 §1.4 回報衝突並提出放寬選項，不自動放寬。
 */
const MORNING_PERIODS = [1, 2, 3, 4];
const WEEKDAYS = [1, 2, 3, 4, 5];

function isMorningEntry(a: { day: number; periods: number[] }): boolean {
  return (
    WEEKDAYS.includes(a.day) &&
    a.periods.length === MORNING_PERIODS.length &&
    MORNING_PERIODS.every((p) => a.periods.includes(p))
  );
}

/** avoidPeriods 是否正好涵蓋週一至週五的整個早上 */
export function isMorningBlock(avoidPeriods: ConstraintSet["avoidPeriods"]): boolean {
  return WEEKDAYS.every((d) => avoidPeriods.some((a) => a.day === d && isMorningEntry(a)));
}

/** 設定或解除「不排早上」，不影響使用者另外指定的其他節次 */
function setMorningBlock(c: ConstraintSet, on: boolean): void {
  const others = c.avoidPeriods.filter((a) => !isMorningEntry(a));
  c.avoidPeriods = on
    ? [...others, ...WEEKDAYS.map((day) => ({ day, periods: [...MORNING_PERIODS] }))]
    : others;
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
  /** 模型推測出來、但使用者沒說出口而被擋下的參數，寫進 trace 供稽核 */
  refusedParams: string[];
};

/**
 * 放寬既有偏好需要使用者明確說出口的依據。
 *
 * §1.4 訂的是「無解時不自動放寬」，但放寬還有另一條路會溜進來：意圖解析把
 * 使用者沒提到的欄位填成 false，而 schema 裡 null 才是「不變」、false 是「關掉」。
 * 實測 qwen3:14b 對「空出星期五」送出 avoidDays=[]、avoidEarly=false、
 * avoidMorning=false、preferCompactDays=false —— 它自己的 reason 寫著
 * "avoidFriday"，卻一個字都沒填進參數，反而把使用者原本設好的「不排早八」關掉了。
 *
 * 增加約束出錯，使用者看得到（課變少了）；解除約束出錯是**無聲**的，
 * 偏好就這樣消失。所以只對「解除」這個方向要求依據，加嚴不受影響。
 */
const RELAX_CUE = /可以|接受|不介意|沒關係|無所謂|都行|開放|取消|解除|恢復|不用|不需要|拿掉限制|放寬/;

/**
 * 數值參數必須在原句裡找得到帶單位的數字。
 *
 * 這是把系統提示第 1 條「只輸出使用者明確說出口的參數，不得推測」用程式執行。
 * 實測 qwen3:14b 對「空出星期五」送出 courseCountTarget=0、maxCredits=0，
 * 把條件設成「期望 0 堂課、學分上限 0」—— 與學則的學期下限直接衝突，必然無解。
 * 它填 0 的意思是「沒提到」，但 schema 裡 null 才是沒提到。
 *
 * 要求單位而不只是數字：「空出星期五」的「五」是星期，不是堂數。
 */
const COUNT_CUE = /(\d+|[一二兩三四五六七八九十]+)\s*[堂門]/;
const CREDIT_CUE = /(\d+|[一二兩三四五六七八九十]+)\s*學分/;

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
  /** 使用者這一句的原文，用來判定「解除某項偏好」是不是他真的說出口的 */
  raw = "",
): ApplyResult {
  if (params.reset) {
    return {
      next: { ...original, avoidDays: [...original.avoidDays], avoidPeriods: [], excludeCourses: [], pinCourses: [], goals: [] },
      delta: { reason: "重設為個人資料的原始設定" },
      unresolved: [],
      refusedParams: [],
    };
  }

  const refusedParams: string[] = [];
  const mayRelax = RELAX_CUE.test(raw);
  /** 解除既有偏好需要依據；沒有依據就擋下並記錄，不動原本的設定 */
  const allowTurnOff = (label: string): boolean => {
    if (mayRelax) return true;
    refusedParams.push(label);
    return false;
  };

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

  const dayName = (d: number) => "一二三四五六日"[d - 1];

  if (params.avoidDays.length > 0) {
    const set = new Set([...next.avoidDays, ...params.avoidDays]);
    for (const d of params.allowDays) {
      if (!set.has(d)) continue;
      if (allowTurnOff(`開放星期${dayName(d)}`)) set.delete(d);
    }
    next.avoidDays = [...set].sort((a, b) => a - b);
    delta.avoidDays = params.avoidDays;
  } else if (params.allowDays.length > 0) {
    const freed = params.allowDays.filter((d) => next.avoidDays.includes(d));
    if (freed.length > 0 && allowTurnOff(`開放星期${freed.map(dayName).join("、")}`)) {
      next.avoidDays = next.avoidDays.filter((d) => !params.allowDays.includes(d));
    }
  }

  if (params.avoidEarly !== null) {
    // 關掉既有的「不排早八」要有依據；設定或維持則照做
    if (params.avoidEarly || !current.avoidEarly || allowTurnOff("接受早八")) {
      next.avoidEarly = params.avoidEarly;
    }
  }
  if (params.avoidMorning !== null) {
    if (params.avoidMorning || !isMorningBlock(current.avoidPeriods) || allowTurnOff("恢復可排早上的課")) {
      setMorningBlock(next, params.avoidMorning);
    }
  }
  if (params.preferCompactDays !== null) {
    if (params.preferCompactDays || !current.preferCompactDays || allowTurnOff("不再要求課程集中")) {
      next.preferCompactDays = params.preferCompactDays;
    }
  }
  if (params.maxCredits !== null) {
    if (CREDIT_CUE.test(raw)) {
      next.maxCredits = params.maxCredits;
      delta.maxCredits = params.maxCredits;
    } else {
      refusedParams.push(`學期學分上限改為 ${params.maxCredits}（原句沒有提到學分數）`);
    }
  }
  if (params.courseCountTarget !== null) {
    if (COUNT_CUE.test(raw)) next.targetCourseCount = params.courseCountTarget;
    else refusedParams.push(`期望 ${params.courseCountTarget} 堂課（原句沒有提到堂數）`);
  } else if (params.courseCountDelta !== null && params.courseCountDelta !== 0) {
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

  return { next, delta, unresolved, refusedParams };
}

/** 把約束集合寫成人看得懂的條件清單，UI 與回覆共用同一份 */
export function describeSet(c: ConstraintSet): string[] {
  const out: string[] = [];
  out.push(GOAL_LABEL[c.goal]);
  const morning = isMorningBlock(c.avoidPeriods);
  // 不排早上已經涵蓋第 1 節，兩條並列只是噪音
  if (morning) out.push("不排早上的課（第 1–4 節）");
  else if (c.avoidEarly) out.push("不排早八（第 1 節）");
  if (c.avoidDays.length > 0) out.push(`空出星期${c.avoidDays.map((d) => "一二三四五六日"[d - 1]).join("、")}`);
  for (const a of c.avoidPeriods) {
    if (morning && isMorningEntry(a)) continue;
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

const GOAL_LABEL = {
  asap: "以最快畢業為目標",
  balanced: "維持正常修課進度",
  light: "這學期修少一點",
} as const;

/**
 * 「改了什麼」——由前後約束集合的**實際差異**產生。
 *
 * README §4 的主張是「對話介面的每一個字都不是模型寫的」。先前這一行直接印
 * LLM 的 `reason` 欄位，於是模型可以宣稱一個它其實沒有套用的改動：實測
 * qwen3:14b 對「不要早上的課」寫出「調整時段：避免早上時段的課程」，
 * 但它唯一能設的參數是只涵蓋第 1 節的 avoidEarly，而且那個值本來就已經是
 * true —— 畫面因此同時出現「已調整時段：避免早上時段的課程」與
 * 「目前條件：不排早八（第 1 節）」兩行互相矛盾的字，且模型那行是錯的。
 *
 * 改成只描述真正生效的差異。沒有差異就回空陣列，由呼叫端據實說明，
 * 絕不把「宣稱有改」和「實際沒改」這兩件事混為一談。
 */
export function describeDelta(before: ConstraintSet, after: ConstraintSet): string[] {
  const out: string[] = [];

  if (before.goal !== after.goal) out.push(`改為${GOAL_LABEL[after.goal]}`);

  const wasMorning = isMorningBlock(before.avoidPeriods);
  const nowMorning = isMorningBlock(after.avoidPeriods);
  if (wasMorning !== nowMorning) out.push(nowMorning ? "不排早上的課（第 1–4 節）" : "恢復可排早上的課");
  // 早上已涵蓋第 1 節，同一輪兩者都變時只講範圍較大的那個
  if (before.avoidEarly !== after.avoidEarly && !nowMorning) {
    out.push(after.avoidEarly ? "不排早八（第 1 節）" : "接受早八");
  }

  const dayName = (d: number) => "一二三四五六日"[d - 1];
  const addedDays = after.avoidDays.filter((d) => !before.avoidDays.includes(d));
  const freedDays = before.avoidDays.filter((d) => !after.avoidDays.includes(d));
  if (addedDays.length > 0) out.push(`空出星期${addedDays.map(dayName).join("、")}`);
  if (freedDays.length > 0) out.push(`開放星期${freedDays.map(dayName).join("、")}`);

  // 早上那一組已由上面描述，這裡只講使用者另外指定的節次
  const others = (c: ConstraintSet) =>
    c.avoidPeriods.filter((a) => !isMorningEntry(a)).map((a) => `${a.day}:${a.periods.join(",")}`);
  const beforeOthers = new Set(others(before));
  for (const key of others(after)) {
    if (beforeOthers.has(key)) continue;
    const [day, periods] = key.split(":");
    out.push(`空出星期${dayName(Number(day))} 第 ${periods!.split(",").join("、")} 節`);
  }

  if (before.targetCourseCount !== after.targetCourseCount && after.targetCourseCount !== undefined) {
    out.push(`改為期望 ${after.targetCourseCount} 堂課`);
  }
  if (before.preferCompactDays !== after.preferCompactDays) {
    // 這些字會被套進「已…。」的句型，所以寫成動詞開頭
    out.push(after.preferCompactDays ? "盡量把課集中在少數幾天" : "不再要求課程集中");
  }
  if (before.maxCredits !== after.maxCredits && after.maxCredits !== undefined) {
    out.push(`把學期學分上限改為 ${after.maxCredits}`);
  }

  for (const code of after.pinCourses.filter((c) => !before.pinCourses.includes(c))) {
    out.push(`保留 ${nameOf(code)}`);
  }
  for (const code of after.excludeCourses.filter((c) => !before.excludeCourses.includes(c))) {
    out.push(`排除 ${nameOf(code)}`);
  }
  for (const g of after.goals.filter((x) => !before.goals.includes(x))) {
    out.push({ "early-graduation": "加入提前畢業目標", minor: "加入輔系需求", "cert-program": "加入學程需求" }[g]);
  }

  return out;
}

function nameOf(code: string): string {
  const o: Offering | undefined = allOfferings().find((x) => x.code === code);
  return o ? `${o.name}（${code}）` : code;
}
