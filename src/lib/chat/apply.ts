import { DEFAULT_PREFERENCES, type Constraints, type CoursePreferences, type Offering } from "@/lib/types";
import { isCourseCode } from "@/lib/courses/code";
import { allOfferings } from "@/lib/offerings";
import type { ConstraintDelta, ConstraintSet } from "./types";
import { BLOCK_CUE, DAY_WORDS, PART_WORDS, dayCues, parseNum, type PlanParams } from "./intent";
import { DEFAULT_SCHOOL } from "@/lib/schools";
import { periodScheme, periodLabel } from "@/lib/offerings/period-scheme";
import { topicCodes } from "./topics";

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
    targetCourseCount: clamp(base.targetCourseCount, 0, 30),
    preferCompactDays: Boolean(base.preferCompactDays),
    note: typeof base.note === "string" ? base.note.slice(0, 200) : undefined,
    extraGoals: Array.isArray(base.extraGoals) ? base.extraGoals.slice(0, 4) : [],
  };
}

function clamp(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;
}

/** 各時段對應的節次（lib/offerings/periods.ts；夜間代號 A–E 為第 11–15 節） */
const PART_PERIODS = {
  // 第 0 節是輔大的特早節 D0（07:10）。說「不要早上的課」的人一定也不要它（TODO H7）；
  // 合成資料沒有第 0 節，多擋一節不影響任何結果
  morning: [0, 1, 2, 3, 4],
  afternoon: [5, 6, 7, 8, 9],
  evening: [10, 11, 12, 13, 14, 15],
} as const;
const PART_NAME = { morning: "早上", afternoon: "下午", evening: "晚上" } as const;
const MORNING_PERIODS: readonly number[] = PART_PERIODS.morning;
const WEEKDAYS = [1, 2, 3, 4, 5];

const sameSet = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && b.every((p) => a.includes(p));

/** 是不是「早上」：第 1–4 節，含或不含第 0 節（加入特早節之前存下的設定是 1–4） */
const isMorningSet = (ps: readonly number[]) => sameSet(ps, MORNING_PERIODS) || sameSet(ps, [1, 2, 3, 4]);

/**
 * 節次的說法。
 *
 * 內部一律用整數節次，但給人看的說法依學校：合成資料說「第 1–4 節」，輔大說「D1–D4」
 * （輔大的內部第 6 節是 D5，直接印整數會說錯）。合成資料的說法維持原樣，逐字不變。
 */
export type PeriodNames = {
  /** 一段節次，如「第 1–4 節」「D1–D4」 */
  span: (ps: readonly number[]) => string;
  /** 列舉，如「第 1、2 節」「D1、D2」 */
  list: (ps: readonly number[]) => string;
  /** 「不排早八」實際擋掉的節次：合成資料是第 1 節，輔大還包含特早節 D0 */
  early: string;
  /** 「不排早上」實際擋掉的節次：合成資料是第 1–4 節，輔大是 D0–D4 */
  morning: string;
};

export const DEMO_PERIOD_NAMES: PeriodNames = {
  span: (ps) => `第 ${ps[0]}–${ps[ps.length - 1]} 節`,
  list: (ps) => `第 ${ps.join("、")} 節`,
  early: "第 1 節",
  morning: "第 1–4 節",
};

export function periodNamesFor(school?: string): PeriodNames {
  const scheme = periodScheme(school);
  if (scheme.school === "demo") return DEMO_PERIOD_NAMES;
  const exists = (p: number) => scheme.rows.some((r) => r.index === p);
  const label = (p: number) => periodLabel(scheme, p);
  return {
    // 時段的範圍是全系統共用的（晚上 10–15），該校沒有的節次不能印出來（輔大只到 E4）
    span: (ps) => {
      const xs = ps.filter(exists);
      return xs.length > 0 ? `${label(xs[0]!)}–${label(xs[xs.length - 1]!)}` : DEMO_PERIOD_NAMES.span(ps);
    },
    list: (ps) => ps.map(label).join("、"),
    early: [0, 1].filter(exists).map(label).join("、"),
    morning: (() => {
      const xs = MORNING_PERIODS.filter(exists);
      return `${label(xs[0]!)}–${label(xs[xs.length - 1]!)}`;
    })(),
  };
}

/**
 * 把一組 avoidPeriods 寫成人話。
 * 平日同一時段全畫掉就合併成一句（「不排下午的課」），剛好是某時段就說「星期五下午」，
 * 否則才列節次。早上整組由 isMorningBlock 另外處理，呼叫端要先濾掉。
 */
function describePeriods(
  entries: { day: number; periods: number[] }[],
  names: PeriodNames = DEMO_PERIOD_NAMES,
): string[] {
  const out: string[] = [];
  let rest = [...entries];
  for (const part of ["afternoon", "evening"] as const) {
    const ps = PART_PERIODS[part];
    const hits = rest.filter((a) => WEEKDAYS.includes(a.day) && sameSet(a.periods, ps));
    if (WEEKDAYS.every((d) => hits.some((a) => a.day === d))) {
      out.push(`不排${PART_NAME[part]}的課（${names.span(ps)}）`);
      rest = rest.filter((a) => !hits.includes(a));
    }
  }
  for (const a of rest) {
    const day = "一二三四五六日"[a.day - 1];
    const part = (Object.keys(PART_PERIODS) as (keyof typeof PART_PERIODS)[]).find((k) =>
      k === "morning" ? isMorningSet(a.periods) : sameSet(a.periods, PART_PERIODS[k]),
    );
    out.push(part ? `空出星期${day}${PART_NAME[part]}` : `空出星期${day} ${names.list(a.periods)}`);
  }
  return out;
}

/*
 * 「早上」＝第 1–4 節（第 5 節 13:20 已是下午），週一至週五。
 *
 * 這與「早八」是兩件不同的事，不得互相代用：
 *   - avoidEarly 只涵蓋第 1 節，而且是**軟**偏好 —— 唯一開課就是早八時照排並標示，
 *     正確的回答是「只剩早八這一門，你自己決定」而不是回報無解（schedule.ts §排除）。
 *   - 不排早上是使用者明確畫掉一段時間，走 avoidPeriods，是**硬**限制；
 *     排不出來時由 §1.4 回報衝突並提出放寬選項，不自動放寬。
 */
function isMorningEntry(a: { day: number; periods: number[] }): boolean {
  return (
    WEEKDAYS.includes(a.day) && isMorningSet(a.periods)
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
    ...(c.maxCourseCount !== undefined ? { maxCourseCount: c.maxCourseCount } : {}),
    preferCompactDays: c.preferCompactDays,
    maxDays: c.maxDays,
    excludeCourses: c.excludeCourses,
    pinCourses: c.pinCourses,
    ...(c.wantTopic
      ? { wantOneOf: c.wantTopic.codes, wantLabel: `${c.wantTopic.label} 相關`, ...(c.wantTopic.days?.length ? { wantDays: c.wantTopic.days } : {}) }
      : {}),
    ...(c.newCourseCredits ? { newCourseCredits: c.newCourseCredits } : {}),
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
  /**
   * 有沒有接受任何具體要求（不論結果是否與現狀相同）。
   * 用來區分兩種「條件沒有變動」：要求的已經是現狀，還是根本沒抓到要改什麼 ——
   * 後者若說成「與目前設定相同」就是在說謊。
   */
  requested: boolean;
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
const RELAX_CUE = /可以|接受|不介意|沒關係|無所謂|都行|開放|取消|解除|恢復|不用|不需要|不限|拿掉限制|放寬/;

/**
 * 數值參數必須在原句裡找得到帶單位的數字。
 *
 * 這是把系統提示第 1 條「只輸出使用者明確說出口的參數，不得推測」用程式執行。
 * 實測 qwen3:14b 對「空出星期五」送出 courseCountTarget=0、maxCredits=0，
 * 把條件設成「期望 0 堂課、學分上限 0」—— 與學則的學期下限直接衝突，必然無解。
 * 它填 0 的意思是「沒提到」，但 schema 裡 null 才是沒提到。
 *
 * 要求單位而不只是數字：「空出星期五」的「五」是星期，不是堂數。
 * 數字在單位前後都要接得住：「15 學分以內」與「學分不要超過 15」是同一件事。
 * 而且值要對得上：句子裡有「三門」不代表模型填的 5 就是使用者說的。
 */
const NUM = "(\\d+|[一二兩三四五六七八九十]+)";
const COUNT_NEAR = [new RegExp(`${NUM}\\s*[堂門]`, "g"), new RegExp(`(?:堂數|門數|堂課).{0,6}?${NUM}`, "g")];
const CREDIT_NEAR = [new RegExp(`${NUM}\\s*學分`, "g"), new RegExp(`學分.{0,6}?${NUM}`, "g")];
/** 句子要是在講學期學分的上限，而不是某一門課幾學分 */
const CREDIT_CAP_CUE = /以內|以下|上限|超過|最多|就好|就夠|頂多|不到/;
/** 「一天」「兩天」；「星期天」「今天」前面不是數字，不會被當成天數 */
const DAYS_NEAR = [new RegExp(`${NUM}\\s*天`, "g")];
/**
 * 句子要是在講「排在幾天內」。「空出一天」也有「一天」，但意思是空出來，不是排進去。
 */
const DAYS_CUE = /集中|排在|塞在|壓在|只.{0,2}上|只.{0,2}排|上完|天內|天以內|天就好/;

/** 原句裡緊鄰某個單位的所有數字 */
function numbersNear(raw: string, patterns: RegExp[]): number[] {
  const out: number[] = [];
  for (const re of patterns) {
    for (const m of raw.matchAll(re)) {
      const n = parseNum(m[1]!);
      if (n !== null) out.push(n);
    }
  }
  return out;
}

/**
 * 堂數的增減要有增減的字，而且方向要一致。
 * 實測 qwen3:14b 對「這學期只想修三門」送出 courseCountDelta=+3，把期望的 2 堂變成 5 堂 ——
 * 使用者說的是「指定三門」，不是「再加三門」。
 */
const MORE_CUE = /多|加|增|再/;
const LESS_CUE = /少|減/;

const GOALS_CUE = {
  "early-graduation": /提前|早點?畢業|提早畢業|早一?學期/,
  minor: /輔系/,
  "cert-program": /學程/,
} as const;

const GOAL_CUE = {
  asap: /提前|快|拚|衝|早點?畢業|多修/,
  balanced: /正常|一般|平衡|適中|普通|照原本|原本的進度/,
  light: /輕|鬆|喘|少修|修少|不要太重|不要太多|太累|負擔/,
} as const;

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
  /**
   * 使用者眼前那份課表的堂數。「多一堂／少一堂」要從這裡加減，而不是從期望堂數 ——
   * 個人資料寫期望 2 堂、實際為了補學分排了 3 堂時，使用者說「少一堂」想的是 3→2，
   * 從期望堂數算會變成 2→1；說「多選一堂」會變成 2→3，剛好等於現狀，課表不會動。
   */
  shownCount?: number,
  /** 學生的學校：用課名找課時只找這一所（各校常有同名的課） */
  school: string = DEFAULT_SCHOOL,
): ApplyResult {
  if (params.reset) {
    return {
      next: {
        ...original,
        avoidDays: [...original.avoidDays],
        avoidPeriods: [],
        excludeCourses: [],
        pinCourses: [],
        goals: [],
        wantTopic: undefined,
        newCourseCredits: undefined,
        skipCategories: undefined,
        maxCourseCount: undefined,
        lastDrop: undefined,
      },
      delta: { reason: "重設為個人資料的原始設定" },
      unresolved: [],
      refusedParams: [],
      requested: true,
    };
  }

  const refusedParams: string[] = [];
  const mayRelax = RELAX_CUE.test(raw);
  let requested = false;
  // 布林設成 false 只有在使用者說可以放寬時才算要求；模型常把沒提到的欄位填 false，那是雜訊
  const meant = (v: boolean) => v || mayRelax;
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

  // 原句是「最好在禮拜一」「解除空出星期一」的，模型給成空出就是反了（Haiku 5.5 實測）。
  // 擋下；原句說解除的，改當成開放
  const cues = dayCues(raw);
  const wrongWay = params.avoidDays.filter((d) => !cues.block.includes(d) && (cues.prefer.includes(d) || cues.free.includes(d)));
  if (wrongWay.length > 0) {
    refusedParams.push(`空出星期${wrongWay.map(dayName).join("、")}（原句不是要空出這幾天）`);
    params = {
      ...params,
      avoidDays: params.avoidDays.filter((d) => !wrongWay.includes(d)),
      allowDays: [...new Set([...params.allowDays, ...wrongWay.filter((d) => cues.free.includes(d))])],
    };
  }

  if (params.avoidDays.length > 0) {
    requested = true;
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
      requested = true;
      next.avoidDays = next.avoidDays.filter((d) => !params.allowDays.includes(d));
    }
  }

  if (params.avoidEarly !== null) {
    if (meant(params.avoidEarly)) requested = true;
    // 關掉既有的「不排早八」要有依據；設定或維持則照做
    if (params.avoidEarly || !current.avoidEarly || allowTurnOff("接受早八")) {
      next.avoidEarly = params.avoidEarly;
    }
  }
  if (params.avoidMorning !== null) {
    if (meant(params.avoidMorning)) requested = true;
    if (params.avoidMorning || !isMorningBlock(current.avoidPeriods) || allowTurnOff("恢復可排早上的課")) {
      setMorningBlock(next, params.avoidMorning);
    }
  }
  // 某天的某時段：星期與時段都要在原句裡找得到。
  // 加嚴本來不需要依據，但模型會編時段 —— 實測 qwen3:14b 把「星期二跟星期四都不要排課」
  // 填成「星期二早上、星期四早上」，把接在「課盡量集中」後的「下午」填成「星期五下午」，
  // 描述雖然如實，套用的卻不是使用者說的。
  // 平日同一時段整組畫掉（「下午不要有課」）不會提到星期，改要求句子是在畫掉時間，
  // 否則「集中在下午」會被反過來套成「不排下午」。
  const partSaid = (p: (typeof params.avoidDayParts)[number]["part"]) =>
    PART_WORDS.some(([re, k]) => k === p && re.test(raw));
  const daySaid = (d: number) => DAY_WORDS.some(([re, k]) => k === d && re.test(raw));
  const allWeekdays = (p: string) =>
    WEEKDAYS.every((d) => params.avoidDayParts.some((x) => x.day === d && x.part === p));
  for (const { day, part } of params.avoidDayParts) {
    const said = partSaid(part) && (daySaid(day) || (allWeekdays(part) && BLOCK_CUE.test(raw)));
    if (!said) {
      refusedParams.push(`空出星期${dayName(day)}${PART_NAME[part]}（原句沒有提到）`);
      continue;
    }
    requested = true;
    const periods = [...PART_PERIODS[part]];
    const covered = next.avoidPeriods.some((a) => a.day === day && periods.every((p) => a.periods.includes(p)));
    if (!covered) next.avoidPeriods.push({ day, periods });
  }
  if (params.preferCompactDays !== null) {
    if (meant(params.preferCompactDays)) requested = true;
    if (params.preferCompactDays || !current.preferCompactDays || allowTurnOff("不再要求課程集中")) {
      next.preferCompactDays = params.preferCompactDays;
    }
  }
  // 課排在幾天內。7＝不限天數，那是解除，要有依據；其餘要對得上原句的「N 天」，
  // 而且句子要是在講排進幾天（「空出一天」不算）
  if (params.maxDays !== null) {
    if (params.maxDays >= 7) {
      if (current.maxDays !== undefined && allowTurnOff("不再限制上課天數")) {
        requested = true;
        next.maxDays = undefined;
      }
    } else if (DAYS_CUE.test(raw) && numbersNear(raw, DAYS_NEAR).includes(params.maxDays)) {
      requested = true;
      next.maxDays = params.maxDays;
    } else {
      refusedParams.push(`課排在 ${params.maxDays} 天內（原句沒有這個天數）`);
    }
  }
  // 數值不只要「有提到」，值還要對得上原句裡緊鄰單位的那個數字
  if (params.maxCredits !== null) {
    // 還要是在講上限：「多選一堂兩學分的課」的「兩學分」是那門課的學分，不是學期上限
    if (CREDIT_CAP_CUE.test(raw) && numbersNear(raw, CREDIT_NEAR).includes(params.maxCredits)) {
      requested = true;
      next.maxCredits = params.maxCredits;
      delta.maxCredits = params.maxCredits;
    } else {
      refusedParams.push(`學期學分上限改為 ${params.maxCredits}（原句沒有這個學分數）`);
    }
  }
  const counts = numbersNear(raw, COUNT_NEAR);
  if (params.courseCountTarget !== null) {
    if (counts.includes(params.courseCountTarget)) {
      requested = true;
      next.targetCourseCount = params.courseCountTarget;
      next.maxCourseCount = undefined;
    } else {
      refusedParams.push(`期望 ${params.courseCountTarget} 堂課（原句沒有這個堂數）`);
    }
  } else if (params.courseCountDelta !== null && params.courseCountDelta !== 0) {
    const d = params.courseCountDelta;
    // 方向要有字撐著；幅度有寫數字就要對得上，沒寫（「多修一點」）就只接受 1
    const direction = d > 0 ? MORE_CUE.test(raw) && !LESS_CUE.test(raw) : LESS_CUE.test(raw) && !MORE_CUE.test(raw);
    const size = counts.length > 0 ? counts.includes(Math.abs(d)) : Math.abs(d) === 1;
    if (direction && size) {
      requested = true;
      next.targetCourseCount = Math.max(0, (shownCount ?? current.targetCourseCount ?? 0) + d);
      next.maxCourseCount = undefined;
    } else {
      refusedParams.push(`堂數${d > 0 ? "增加" : "減少"} ${Math.abs(d)} 堂（原句不是這個意思）`);
    }
  }
  // 修課目標也要原句有對應的字。實測 qwen3:14b 對「多選一堂課」同時填了 goal=light，
  // 回覆變成「已改為這學期修少一點」，跟使用者說的正好相反
  if (params.goal !== null && raw && !GOAL_CUE[params.goal].test(raw)) {
    refusedParams.push(`修課目標改為${{ asap: "最快畢業", balanced: "正常進度", light: "輕量修課" }[params.goal]}（原句沒有提到）`);
  } else if (params.goal !== null) {
    requested = true;
    next.goal = params.goal;
  }
  // 額外目標同理。實測 qwen3:14b 對「多選一堂課」填了 goals=["minor"]，回「已加入輔系需求」
  const goals = raw ? params.goals.filter((g) => GOALS_CUE[g].test(raw)) : params.goals;
  for (const g of params.goals.filter((x) => !goals.includes(x))) {
    refusedParams.push(`${{ "early-graduation": "加入提前畢業目標", minor: "加入輔系需求", "cert-program": "加入學程需求" }[g]}（原句沒有提到）`);
  }
  if (goals.length > 0) {
    requested = true;
    next.goals = [...new Set([...next.goals, ...goals])];
    delta.goals = goals;
    // 「提前畢業」在求解層面就是把目標換成最快畢業
    if (goals.includes("early-graduation")) next.goal = "asap";
  }

  const offerings = allOfferings(school);
  const resolve = (name: string): string | null => {
    const q = name.replace(/\s/g, "");
    const byCode = offerings.find((o) => o.code.toUpperCase() === q.toUpperCase());
    if (byCode) return byCode.code;
    // 比的是課號而不是開課筆數：輔大同一門課每個班、每個學期都是同一個課號
    // （人生哲學一學期 77 個班都是 00007），以筆數判斷唯一會讓真實資料裡
    // 「把人生哲學換掉」永遠查不到。名稱完全相同的優先，部分相符的才退而求其次
    const unique = (xs: Offering[]) => {
      const codes = [...new Set(xs.map((o) => o.code))];
      return codes.length === 1 ? codes[0]! : null;
    };
    return (
      unique(offerings.filter((o) => o.name === q)) ??
      unique(offerings.filter((o) => o.name.includes(q) || q.includes(o.name)))
    );
  };

  for (const raw of params.excludeCourses) {
    const code = resolve(raw);
    if (!code) {
      unresolved.push(raw);
      continue;
    }
    requested = true;
    if (!next.excludeCourses.includes(code)) next.excludeCourses.push(code);
    next.pinCourses = next.pinCourses.filter((c) => c !== code);
  }
  for (const raw of params.pinCourses) {
    const code = resolve(raw);
    if (!code) {
      unresolved.push(raw);
      continue;
    }
    requested = true;
    if (!next.pinCourses.includes(code)) next.pinCourses.push(code);
    next.excludeCourses = next.excludeCourses.filter((c) => c !== code);
  }
  if (next.excludeCourses.length > 0) delta.excludeCourses = next.excludeCourses;
  if (next.pinCourses.length > 0) delta.pinCourses = next.pinCourses;

  // 「想修一堂 AI 相關的課」（TODO G2）：主題轉成符合的課號，排課時至少排一門。
  // 主題也要原句有：模型隨手填的不算
  const topic = params.addTopic?.trim();
  // 「那堂AI的最好排在禮拜四」：已經在課表上的主題課改天數，不是再加一門
  const sameTopic = current.wantTopic && raw.toLowerCase().includes(current.wantTopic.label.toLowerCase());
  const preferDays = [...new Set(cues.prefer.filter((d) => !cues.block.includes(d)))].sort((a, b) => a - b);
  if (sameTopic && preferDays.length > 0 && (!topic || topic.toLowerCase() === current.wantTopic!.label.toLowerCase())) {
    requested = true;
    next.wantTopic = { ...current.wantTopic!, days: preferDays };
  } else if (topic && (!raw || raw.toLowerCase().includes(topic.toLowerCase()))) {
    const codes = topicCodes(offerings, topic);
    if (codes.length === 0) unresolved.push(`${topic} 相關的課`);
    else {
      requested = true;
      // 「最好幫我安排在禮拜一、二、四」：說的是這門課要排哪天，不是空出哪天（使用者回饋）
      const days = cues.prefer.filter((d) => !cues.block.includes(d));
      next.wantTopic = { label: topic, codes, ...(days.length > 0 ? { days: [...new Set(days)].sort((a, b) => a - b) } : {}) };
      // 沒有另外說堂數：多排一門給它，不擠掉眼前課表上的課。
      // 「換成」是替換，堂數不變；同時拿掉某一類時，堂數由呼叫端依拿掉幾門計算（route.ts）
      if (
        params.courseCountTarget === null &&
        (params.courseCountDelta ?? 0) === 0 &&
        shownCount !== undefined &&
        !params.replace &&
        !params.dropCategory
      ) {
        next.targetCourseCount = shownCount + 1;
        if (next.maxCourseCount !== undefined) next.maxCourseCount = shownCount + 1;
      }
    }
  }
  // 「多選一堂兩學分的課」（TODO G1）：只限新加的那門，偏好。數字要對得上原句
  const per = params.newCourseCredits;
  if (per !== null && per !== undefined) {
    if (!raw || numbersNear(raw, CREDIT_NEAR).includes(per)) {
      requested = true;
      next.newCourseCredits = per;
    } else {
      refusedParams.push(`新加的課 ${per} 學分（原句沒有這個學分數）`);
    }
  }

  return { next, delta, unresolved, refusedParams, requested };
}

/** 把約束集合寫成人看得懂的條件清單，UI 與回覆共用同一份 */
export function describeSet(c: ConstraintSet, names: PeriodNames = DEMO_PERIOD_NAMES): string[] {
  const out: string[] = [];
  out.push(GOAL_LABEL[c.goal]);
  const morning = isMorningBlock(c.avoidPeriods);
  // 不排早上已經涵蓋第 1 節，兩條並列只是噪音
  if (morning) out.push(`不排早上的課（${names.morning}）`);
  else if (c.avoidEarly) out.push(`不排早八（${names.early}）`);
  if (c.avoidDays.length > 0) out.push(`空出星期${c.avoidDays.map((d) => "一二三四五六日"[d - 1]).join("、")}`);
  out.push(...describePeriods(c.avoidPeriods.filter((a) => !(morning && isMorningEntry(a))), names));
  if (c.targetCourseCount !== undefined) out.push(`期望 ${c.targetCourseCount} 堂課`);
  if (c.preferCompactDays) out.push("課程盡量集中在少數幾天");
  if (c.maxDays !== undefined) out.push(`課排在 ${c.maxDays} 天內`);
  if (c.maxCredits !== undefined) out.push(`學期學分上限 ${c.maxCredits}`);
  for (const code of c.pinCourses) out.push(`保留 ${nameOf(code)}`);
  for (const code of c.excludeCourses) out.push(`排除 ${nameOf(code)}`);
  for (const x of c.skipCategories ?? []) out.push(`這學期不排「${x.name}」`);
  if (c.wantTopic) {
    const on = c.wantTopic.days?.length ? `（排在星期${c.wantTopic.days.map((d) => "一二三四五六日"[d - 1]).join("、")}）` : "";
    out.push(`至少一門「${c.wantTopic.label}」相關的課${on}`);
  }
  if (c.newCourseCredits) out.push(`新加的課盡量 ${c.newCourseCredits} 學分`);
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
export function describeDelta(
  before: ConstraintSet,
  after: ConstraintSet,
  names: PeriodNames = DEMO_PERIOD_NAMES,
): string[] {
  const out: string[] = [];

  if (before.goal !== after.goal) out.push(`改為${GOAL_LABEL[after.goal]}`);

  const wasMorning = isMorningBlock(before.avoidPeriods);
  const nowMorning = isMorningBlock(after.avoidPeriods);
  if (wasMorning !== nowMorning) out.push(nowMorning ? `不排早上的課（${names.morning}）` : "恢復可排早上的課");
  // 早上已涵蓋第 1 節，同一輪兩者都變時只講範圍較大的那個
  if (before.avoidEarly !== after.avoidEarly && !nowMorning) {
    out.push(after.avoidEarly ? `不排早八（${names.early}）` : "接受早八");
  }

  const dayName = (d: number) => "一二三四五六日"[d - 1];
  const addedDays = after.avoidDays.filter((d) => !before.avoidDays.includes(d));
  const freedDays = before.avoidDays.filter((d) => !after.avoidDays.includes(d));
  if (addedDays.length > 0) out.push(`空出星期${addedDays.map(dayName).join("、")}`);
  if (freedDays.length > 0) out.push(`開放星期${freedDays.map(dayName).join("、")}`);

  // 早上整組已由上面描述，這裡只講其餘的節次。只有「整組都在」時才濾掉早上的項目 ——
  // 單獨一筆「星期一早上」不是整組，要照常列出來。
  const listed = (c: ConstraintSet) => {
    const block = isMorningBlock(c.avoidPeriods);
    return c.avoidPeriods.filter((a) => !(block && isMorningEntry(a)));
  };
  const key = (a: { day: number; periods: number[] }) => `${a.day}:${[...a.periods].sort((x, y) => x - y).join(",")}`;
  const beforeKeys = new Set(listed(before).map(key));
  out.push(...describePeriods(listed(after).filter((a) => !beforeKeys.has(key(a))), names));

  if (before.targetCourseCount !== after.targetCourseCount && after.targetCourseCount !== undefined) {
    out.push(`改為期望 ${after.targetCourseCount} 堂課`);
  }
  if (before.preferCompactDays !== after.preferCompactDays) {
    // 這些字會被套進「已…。」的句型，所以寫成動詞開頭
    out.push(after.preferCompactDays ? "盡量把課集中在少數幾天" : "不再要求課程集中");
  }
  if (before.maxDays !== after.maxDays) {
    out.push(after.maxDays !== undefined ? `把課排在 ${after.maxDays} 天內` : "不再限制上課天數");
  }
  if (before.maxCredits !== after.maxCredits && after.maxCredits !== undefined) {
    out.push(`把學期學分上限改為 ${after.maxCredits}`);
  }

  for (const code of after.pinCourses.filter((c) => !before.pinCourses.includes(c))) {
    out.push(`保留 ${nameOf(code)}`);
  }
  if (after.wantTopic && after.wantTopic.label === before.wantTopic?.label && (after.wantTopic.days ?? []).join() !== (before.wantTopic.days ?? []).join()) {
    const d = after.wantTopic.days ?? [];
    out.push(d.length > 0 ? `「${after.wantTopic.label}」相關的課排在星期${d.map((x) => "一二三四五六日"[x - 1]).join("、")}` : `「${after.wantTopic.label}」相關的課不限星期`);
  }
  if (after.wantTopic && after.wantTopic.label !== before.wantTopic?.label) {
    const on = after.wantTopic.days?.length ? `，排在星期${after.wantTopic.days.map((d) => "一二三四五六日"[d - 1]).join("、")}` : "";
    out.push(`加一門「${after.wantTopic.label}」相關的課${on}`);
  }
  if (after.newCourseCredits && after.newCourseCredits !== before.newCourseCredits) {
    out.push(`新加的課盡量 ${after.newCourseCredits} 學分`);
  }
  for (const code of after.excludeCourses.filter((c) => !before.excludeCourses.includes(c))) {
    out.push(`排除 ${nameOf(code)}`);
  }
  for (const c of (after.skipCategories ?? []).filter((x) => !(before.skipCategories ?? []).some((y) => y.id === x.id))) {
    out.push(`這學期不排「${c.name}」`);
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

/**
 * 前端送上來的約束集合要當成不可信輸入。
 *
 * 每一輪對話前端都會把目前的約束集合送回來，所以這裡漏掉的欄位會在下一輪**無聲消失**。
 * 從 API 路由搬到這裡，是為了能單獨測（Next 的路由檔只能匯出 HTTP 方法）。
 *
 * avoidPeriods 的上限原本是 7 筆，但「不排早上」本身就佔 5 筆（週一到週五），
 * 再加「下午不要有課」的 5 筆就會在下一輪被截掉 3 筆。改成 7 天 × 3 個時段。
 */
export function sanitiseConstraintSet(c: ConstraintSet, fallback: ConstraintSet): ConstraintSet {
  const days = (x: unknown) =>
    Array.isArray(x) ? [...new Set(x.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))] : [];
  const codes = (x: unknown) =>
    // 排除與保留的課會一輪一輪累積，舊值 10 會在第 11 門時把最早排除的課無聲丟掉
    Array.isArray(x) ? [...new Set(x.filter(isCourseCode))].slice(0, 50) : [];
  const num = (x: unknown, lo: number, hi: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : undefined;

  return {
    goal: ["asap", "balanced", "light"].includes(c?.goal) ? c.goal : fallback.goal,
    avoidEarly: Boolean(c?.avoidEarly),
    avoidDays: days(c?.avoidDays),
    avoidPeriods: Array.isArray(c?.avoidPeriods)
      ? c.avoidPeriods
          .filter((a) => Number.isInteger(a?.day) && a.day >= 1 && a.day <= 7 && Array.isArray(a?.periods))
          .slice(0, 21)
          // 輔大一天有 16 節（D0 到 E4），舊值 15 會把整天不排的最後一節 E4 丟掉
          .map((a) => ({ day: a.day, periods: [...new Set(a.periods.filter((p) => Number.isInteger(p) && p >= 0 && p <= 20))] }))
      : [],
    maxCredits: num(c?.maxCredits, 0, 30),
    minCredits: num(c?.minCredits, 0, 30),
    // 堂數真正的上限是學分上限；這裡只擋明顯不合理的輸入（舊值 10，學分上限 25 時排得進 12 門 2 學分的課）
    targetCourseCount: num(c?.targetCourseCount, 0, 30),
    preferCompactDays: Boolean(c?.preferCompactDays),
    maxDays: num(c?.maxDays, 1, 6),
    excludeCourses: codes(c?.excludeCourses),
    pinCourses: codes(c?.pinCourses),
    // 主題課：課號要合法、說法限長度；符合的課號可能多，上限放寬到 200
    ...(c?.wantTopic && typeof c.wantTopic.label === "string" && Array.isArray(c.wantTopic.codes)
      ? {
          wantTopic: {
            label: c.wantTopic.label.slice(0, 20),
            codes: [...new Set(c.wantTopic.codes.filter(isCourseCode))].slice(0, 200),
            ...(Array.isArray(c.wantTopic.days)
              ? { days: [...new Set(c.wantTopic.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b) }
              : {}),
          },
        }
      : {}),
    ...(num(c?.newCourseCredits, 1, 6) !== undefined ? { newCourseCredits: num(c?.newCourseCredits, 1, 6) } : {}),
    ...(num(c?.maxCourseCount, 1, 12) !== undefined ? { maxCourseCount: num(c?.maxCourseCount, 1, 12) } : {}),
    ...(c?.lastDrop && typeof c.lastDrop.category === "string" && isCourseCode(c.lastDrop.code)
      ? { lastDrop: { category: c.lastDrop.category.slice(0, 12), code: c.lastDrop.code } }
      : {}),
    ...(Array.isArray(c?.skipCategories)
      ? {
          skipCategories: c.skipCategories
            .filter((x) => x && typeof x.id === "string" && typeof x.name === "string")
            .slice(0, 8)
            .map((x) => ({ id: x.id.slice(0, 40), name: x.name.slice(0, 20) })),
        }
      : {}),
    goals: Array.isArray(c?.goals)
      ? c.goals.filter((g): g is ConstraintSet["goals"][number] =>
          ["early-graduation", "minor", "cert-program"].includes(g as string),
        )
      : [],
    note: typeof c?.note === "string" ? c.note.slice(0, 200) : fallback.note,
  };
}
