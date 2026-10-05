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
 * 選課組合求解（docs/BACKEND.md §5）。
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
  /** 系所限制：這一類裡要由哪個系所開的課來補（輔大「選修中包含本系專業選修至少 10 學分」） */
  dept?: string;
  /** 承接類別（任何及格的課都收，如其他選修）的學分需求。排課時最後才補，見 G4 */
  catchAll?: boolean;
};

/** 分項需求（領域、系所）：一門課同時補類別學分和分項，分開計算 */
const isSub = (r: Requirement) => Boolean(r.domain || r.dept);

/** 這一班能不能補這項需求 */
function meets(o: Offering, r: Requirement): boolean {
  return (
    o.category.includes(r.categoryId) &&
    (!r.domain || o.generalDomain === r.domain) &&
    (!r.dept || o.dept === r.dept)
  );
}

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
        ...(cat.catchAll ? { catchAll: true } : {}),
      });
    }
    for (const sub of cat.subRules) {
      if (sub.status !== "unmet" || !sub.items) continue;
      // 「修課中」的領域這學期就會補上，不用再排。以學分判定的（輔大各領域 4 學分）
      // 帶著「已修 0／4 學分」的備註 —— 以前用「沒有備註」篩選，這種領域整個被漏掉，排課不知道要補
      for (const item of sub.items.filter((i) => !i.ok && i.note !== "修課中")) {
        if (item.dept) {
          reqs.push({
            id: `${cat.id}:dept:${item.dept}`,
            label: `${cat.name}·${item.label} ${item.shortBy ?? 0} 學分`,
            shortLabel: `${cat.name}·${item.label}`,
            categoryId: cat.id,
            dept: item.dept,
            minCredits: item.shortBy ?? 0,
          });
          continue;
        }
        const byCredits = item.shortBy !== undefined && item.shortBy > 0;
        reqs.push({
          id: `${cat.id}:domain:${item.label}`,
          label: byCredits
            ? `${cat.name}·${item.label}領域 ${item.shortBy} 學分`
            : `${cat.name}·${item.label}領域 至少 1 門`,
          shortLabel: `${cat.name}·${item.label}`,
          categoryId: cat.id,
          domain: item.label,
          minCredits: byCredits ? item.shortBy! : 0,
          ...(byCredits ? {} : { minCourses: 1 }),
        });
      }
    }
  }
  return reqs;
}

// ------------------------------------------------------------------ 過濾

type Candidate = {
  offering: Offering;
  /** null：開課資料沒有提供人數，不是額滿 */
  remaining: number | null;
  /** 本課程可滿足哪些需求 */
  satisfies: string[];
  /**
   * satisfies 在 ctx.requirements 裡的索引，分成類別學分需求與領域需求。
   * 求解時每個節點要算好幾次缺口，預先算好索引，shortfall 只做數字運算
   */
  creditIdx: number[];
  domainIdx: number[];
  early: boolean;
  prereqWarning?: string;
  slotUnknownNote?: boolean;
  /** 使用者指定一定要留的課，任何解都必須包含 */
  pinned: boolean;
  /** 這學期該修的課（學年課的下半、規劃在這個年級的本系必修），要優先排 */
  continues: boolean;
};

/**
 * 同一門課最多試幾個不同時段的班。
 *
 * 輔大一學期國文九十幾班、外國語文兩百多班，課表上它們只差在時段。全部放進搜尋，
 * 時間都花在「同一門課換一班」上（大一的案例一次求解要將近 10 秒）。
 * 留下時段各不相同的前幾班已足夠避開衝堂；被略過的班不是「排除」，不列在排除清單裡
 */
const SECTION_LIMIT = 6;

/** 補的需求、學分都一樣的課最多試幾門（見 filterCandidates 的 capClasses） */
const CLASS_LIMIT = 8;

export type SolveContext = {
  offerings: Offering[];
  requirements: Requirement[];
  /** 已及格／抵免之課號，供 explicit 先修判定 */
  passedCodes: Set<string>;
  /** 已修畢或正在修的課號，不再建議（學年課要上下兩半都修過，見 solver/taken.ts） */
  takenCodes: Set<string>;
  /** 學年課只修了上半：下半要優先排（solver/taken.ts 的 continuingCourseCodes） */
  continueCodes?: Set<string>;
  /** continueCodes 裡這學期真的有開、也沒被排除的（求解時算出，呼叫端不用填） */
  continueOffered?: Set<string>;
  /** 入學學年。配合 termLabel 算出排課那學期是大幾，高年級的必修不排給低年級 */
  admissionYear?: number;
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
  /**
   * 使用者眼前課表的課號。規劃條件平手時優先保留這些課，對話中的調整才不會無緣無故大換血。
   * 只影響平手時的順序，不影響可行性。
   */
  keep?: string[];
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
  if (c.maxDays !== undefined) out.push(`課排在 ${c.maxDays} 天內`);
  if (c.maxCredits !== undefined) out.push(`學期學分上限 ${c.maxCredits}`);
  return out;
}

const DAY_NAME: Record<number, string> = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "日" };

type Exclusion = { reason: string; code: string; name: string; step: ExclusionReason["step"] };

// 一學期最多幾門。以前是 6，比輔大學生實際修的少（大一下有學分的課就有 7 門）；
// 真正的上限是學分上限（25），這裡只是搜尋深度
const MAX_COURSES = 8;
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
  const termYear = /^(\d{3})-/.exec(ctx.termLabel)?.[1];
  const studyYear =
    ctx.admissionYear !== undefined && termYear !== undefined ? Number(termYear) - ctx.admissionYear + 1 : undefined;
  const pinned = new Set(ctx.constraints.pinCourses ?? []);

  for (const o of [...ctx.offerings].sort((a, b) => cmp(a.code, b.code))) {
    const drop = (step: ExclusionReason["step"], reason: string) =>
      exclusions.push({ reason, code: o.code, name: o.name, step });

    // 0. 使用者明講不要的課
    if (excluded.has(o.code)) {
      drop("excluded-by-user", "你指定不要這門課");
      continue;
    }

    // 0.5 已經修過（或正在修）的課不再建議
    if (ctx.takenCodes.has(o.code)) {
      drop("already-taken", "已經修過");
      continue;
    }

    // 0.6 規劃表排在更高年級的本系必修，不排給低年級（大一不會被排到大二的統計學）。
    // 選修、通識沒有年級限制
    if (studyYear !== undefined && o.forGrade !== undefined && o.forGrade > studyYear) {
      drop("later-grade", `規劃表排在大${"一二三四"[o.forGrade - 1] ?? o.forGrade}`);
      continue;
    }

    // 1. 類別符合。不符合的不是「排除」，而是降級為湊學分下限用的候選
    const satisfies = o.category.some((c) => relevantCats.has(c))
      ? ctx.requirements
          .filter((r) => meets(o, r))
          .map((r) => r.id)
      : [];

    // 2. 先修已修畢（僅 explicit 當硬限制）
    const explicit = o.prerequisites.filter((p) => p.confidence === "explicit");
    const missing = explicit.flatMap((p) => p.codes).filter((c) => !ctx.passedCodes.has(c));
    if (missing.length > 0) {
      drop("prerequisite", `先修科目未修畢（${missing.join("、")}）`);
      continue;
    }

    // 3. 餘額 > 0。人數未知時不排除 —— 未知不是額滿（輔大的系上課表就沒有人數）
    const remaining =
      o.capacity === undefined || o.enrolled === undefined ? null : Math.max(0, o.capacity - o.enrolled);
    if (remaining !== null && remaining <= 0) {
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
    const idx = (domain: boolean) =>
      ctx.requirements.flatMap((r, k) => (satisfies.includes(r.id) && isSub(r) === domain ? [k] : []));
    const c: Candidate = {
      offering: o,
      remaining,
      satisfies,
      creditIdx: idx(false),
      domainIdx: idx(true),
      early: !o.slotsUnknown && isEarlyMorning(o.slots),
      prereqWarning: soft?.sourceText,
      slotUnknownNote: o.slotsUnknown,
      pinned: pinned.has(o.code),
      // 「這學期該修的課」：學年課的下半，以及規劃在這個年級（或更早、還沒修）的本系必修
      continues:
        (ctx.continueCodes?.has(o.code) ?? false) ||
        (studyYear !== undefined && o.forGrade !== undefined && o.forGrade <= studyYear),
    };
    if (satisfies.length > 0 || c.pinned) candidates.push(c);
    else fillers.push(c);
  }

  // 同一門課只留時段不同的前幾班（指定保留的課不限）
  const capSections = (list: Candidate[]) => {
    const seen = new Map<string, Set<string>>();
    return list.filter((c) => {
      if (c.pinned) return true;
      const slots = seen.get(c.offering.code) ?? new Set<string>();
      seen.set(c.offering.code, slots);
      const key = c.offering.rawSlotText ?? "";
      if (slots.has(key) || slots.size >= SECTION_LIMIT) return false;
      slots.add(key);
      return true;
    });
  };
  // 對排課來說可以互換的課（補的需求一樣、學分一樣）只留前幾門。輔大一學期的通識上百門，
  // 同領域 2 學分的課彼此只差在時段與課名，全部放進搜尋只會撞到 NODE_LIMIT（大一的案例要 10 秒）。
  // 指定保留、學年課下半不受限
  const capClasses = (list: Candidate[]) => {
    const codesByClass = new Map<string, Set<string>>();
    return list.filter((c) => {
      if (c.pinned || c.continues) return true;
      const key = `${[...c.satisfies].sort().join("|")}:${c.offering.credits}`;
      const codes = codesByClass.get(key) ?? new Set<string>();
      codesByClass.set(key, codes);
      if (codes.has(c.offering.code)) return true;
      if (codes.size >= CLASS_LIMIT) return false;
      codes.add(c.offering.code);
      return true;
    });
  };
  return { candidates: capClasses(capSections(candidates)), fillers: capSections(fillers), exclusions };

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
        // 同一門課分好幾班會重複出現（輔大的國文有九十幾班），例子只列不同的課
        examples: [...new Set(list.map((e) => `${e.name}（${e.code}）`))].slice(0, 3),
      })),
  };
}

// ------------------------------------------------------------------ 評分

type Score = {
  unmetAfter: number;
  /** 扣掉承接類別之後還缺多少（見 shortfallParts） */
  unmetSpecific: number;
  /** 有開課、卻沒排進來的學年課下半 */
  missedContinuations: number;
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

/**
 * 排完這組課之後還缺多少。
 *
 * 一門課可能同時符合好幾個類別（本系選修同時符合系專選與其他選修），但審查時它只能歸一類。
 * 以前每個類別各算一次，3 學分的本系選修被當成補了 6 學分 —— 求解器因此偏愛這種課，
 * 把只符合一類的必修（人生哲學）、通識擠掉。
 *
 * 現在類別學分的需求，每門課的學分只分給一個：先處理選擇少的課，分給還缺最多的類別
 * （與審查引擎的指派同一個精神，這裡用貪婪法近似，只用於評分）。
 * 領域需求是類別底下的分項條件，同一門通識本來就同時補通識學分和該領域，照舊另外計算。
 */
function shortfall(sel: Candidate[], reqs: Requirement[]): number {
  return shortfallParts(sel, reqs).total;
}

/**
 * total    —— 全部還缺多少
 * specific —— 扣掉承接類別（任何及格的課都收，如選修課程）之後還缺多少
 *
 * 排課先把 specific 降到最低，再看 total（TODO G4）：一學期最多排 6 門，只看 total 的話，
 * 3 學分的選修永遠贏過 2 學分的人生哲學 —— 但選修什麼課都能補、哪個學期都能補，必修不行。
 */
function shortfallParts(sel: Candidate[], reqs: Requirement[]): { total: number; specific: number } {
  const need = reqs.map((r) => r.minCredits);
  const hits = new Array<number>(reqs.length).fill(0);
  // 選擇少的課先分；同樣多的依課號，結果才確定
  const order =
    sel.length > 1
      ? [...sel].sort((a, b) => a.creditIdx.length - b.creditIdx.length || cmp(a.offering.code, b.offering.code))
      : sel;
  for (const c of order) {
    if (c.creditIdx.length === 0) continue;
    // 與審查引擎的指派一致：承接類別最後才分（還有缺口的特定類別優先），其餘分給缺最多的
    const rank = (k: number) => (need[k]! > 0 && !reqs[k]!.catchAll ? 1 : 0);
    let pick = c.creditIdx[0]!;
    for (const k of c.creditIdx) {
      if (rank(k) > rank(pick) || (rank(k) === rank(pick) && need[k]! > need[pick]!)) pick = k;
    }
    need[pick] = Math.max(0, need[pick]! - c.offering.credits);
  }
  for (const c of sel) {
    for (const k of c.domainIdx) {
      need[k] = Math.max(0, need[k]! - c.offering.credits);
      hits[k]! += 1;
    }
  }
  // 分項需求（領域、本系選修）的學分包含在所屬類別的學分裡，不是另外加的：
  // 通識還差 8、自然與社會各差 4，總共還是差 8，不是 16。每一類取「類別缺口」與「分項缺口合計」的較大者。
  // 以前直接相加，一門有領域的通識被算成兩倍的價值，大一的必修因此被通識擠掉
  const byCat = new Map<string, { cat: number; subs: number; catchAll: boolean }>();
  reqs.forEach((r, k) => {
    const gap = need[k]! + (r.minCourses && hits[k]! < r.minCourses ? DOMAIN_WEIGHT : 0);
    const e = byCat.get(r.categoryId) ?? { cat: 0, subs: 0, catchAll: false };
    if (isSub(r)) e.subs += gap;
    else {
      e.cat += gap;
      e.catchAll = Boolean(r.catchAll);
    }
    byCat.set(r.categoryId, e);
  });
  let total = 0;
  let specific = 0;
  for (const e of byCat.values()) {
    const gap = Math.max(e.cat, e.subs);
    total += gap;
    // 承接類別（選修課程）本身什麼課都能補，只有它的分項（本系選修）算特定缺口
    specific += e.catchAll ? e.subs : gap;
  }
  return { total, specific };
}

function score(sel: Candidate[], ctx: SolveContext): Score {
  const totalCredits = sel.reduce((a, c) => a + c.offering.credits, 0);
  const days = new Set<number>();
  for (const c of sel) for (const s of c.offering.slots) days.add(s.day);
  const target = ctx.constraints.targetCourseCount;
  return {
    ...(() => {
      const p = shortfallParts(sel, ctx.requirements);
      return { unmetAfter: p.total, unmetSpecific: p.specific };
    })(),
    missedContinuations: [...(ctx.continueOffered ?? [])].filter((code) => !sel.some((c) => c.offering.code === code)).length,
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
 * 嚴格求解：**不自動放寬**使用者設定的條件（docs/CONVERSATION.md §1.4）。
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
  const filtered = filterCandidates(ctx);
  const { candidates, fillers, exclusions } = filtered;
  // 學年課下半：這學期有開、也沒被排除的才算「應該接上」—— 沒開的不能怪課表
  ctx = { ...ctx, continueOffered: new Set([...candidates, ...fillers].filter((c) => c.continues).map((c) => c.offering.code)) };
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

  // 3. backtracking（pinned 不進搜尋空間，永遠在解裡）。
  //
  // 嘗試順序：能補「特定缺口」（必修、核心、通識領域、本系選修）的課先試，其次才是只能補承接類別的，
  // 同一組裡學分大的先。以前只照學分排：輔大一學期四百多個候選，3 學分的選修排在前面，
  // 搜尋到 NODE_LIMIT 就停，2 學分的人生哲學根本沒被試到（TODO G4）
  // 學年課下半最先，其次能補特定缺口的，最後只能補承接類別的
  const specificRank = (c: Candidate) =>
    c.continues
      ? -1
      : [...c.creditIdx, ...c.domainIdx].some((k) => !ctx.requirements[k]!.catchAll || isSub(ctx.requirements[k]!))
        ? 0
        : 1;
  const byPriority = (a: Candidate, b: Candidate) =>
    specificRank(a) - specificRank(b) || b.offering.credits - a.offering.credits || cmp(a.offering.code, b.offering.code);
  const usableFillers = [...fillers]
    .sort((a, b) => b.offering.credits - a.offering.credits || cmp(a.offering.code, b.offering.code))
    .slice(0, FILLER_LIMIT);
  const sorted = [...candidates.filter((c) => !c.pinned).sort(byPriority), ...usableFillers];
  const suffix = new Array<number>(sorted.length + 1).fill(0);
  for (let i = sorted.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + sorted[i]!.offering.credits;

  const gainFactor = ctx.requirements.some((r) => isSub(r) && r.minCredits > 0) ? 2 : 1;
  const solutions: { sel: Candidate[]; score: Score }[] = [];
  let bestKey: [number, number, number] = [Infinity, Infinity, Infinity];
  /** 所有組合裡最小的總缺口（無解判定用；去掉贅餘的課不會改變它，所以不必先做贅餘檢查） */
  let minTotal = Number.POSITIVE_INFINITY;
  const continueOffered = [...(ctx.continueOffered ?? [])];
  const missedOf = (cs: Candidate[]) => continueOffered.filter((code) => !cs.some((c) => c.offering.code === code)).length;
  const sel: Candidate[] = [...pinnedCandidates];
  let nodes = 0;
  let truncated = false;

  const dfs = (i: number, credits: number): void => {
    if (truncated) return;
    if (++nodes > NODE_LIMIT) {
      truncated = true;
      return;
    }
    const parts = shortfallParts(sel, ctx.requirements);
    if (sel.length > 0) {
      // 邊搜邊比：後面挑解只看（漏接的該修課、特定缺口、總缺口）最好的那一群，
      // 比目前最好的差就不必存、也不必做贅餘檢查與完整評分。挑出來的結果與全部存下來再挑相同
      minTotal = Math.min(minTotal, parts.total);
      const missed = missedOf(sel);
      const cmpKey = missed - bestKey[0] || parts.specific - bestKey[1] || parts.total - bestKey[2];
      if (cmpKey <= 0 && isIrredundant(sel, ctx, pinnedCandidates.length)) {
        if (cmpKey < 0) {
          solutions.length = 0;
          bestKey = [missed, parts.specific, parts.total];
        }
        solutions.push({ sel: [...sel], score: score(sel, ctx) });
      }
    }
    if (i >= sorted.length || sel.length >= MAX_COURSES) return;

    // 剪枝：剩餘候選可提供學分 < 尚缺學分
    // 以學分計的領域需求：一門通識同時補通識學分和該領域，最多能減掉兩倍學分
    if (parts.total > gainFactor * suffix[i]! + DOMAIN_WEIGHT * ctx.requirements.length) return;

    for (let j = i; j < sorted.length; j++) {
      const c = sorted[j]!;
      // 剪枝：已選學分 > maxCredits
      if (credits + c.offering.credits > maxCredits) continue;
      // 同一門課分好幾班（輔大的微積分有甲、乙兩班，同一個課號、不同時段），
      // 一份課表只能選其中一班。合成資料沒有多班的課，這條以前從沒被觸發過
      if (sel.some((s) => s.offering.code === c.offering.code)) continue;
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
  // 不用 Math.min(...)：可行解可以多到幾十萬組（輔大一學期六百多班），展開成參數會撐爆呼叫堆疊
  const bestUnmet = minTotal;
  if (bestUnmet > 0 && !allowPartial) {
    return {
      ok: false,
      infeasibilities: ctx.requirements.map((r) => buildInfeasibility(r, ctx, exclusions)),
      excluded,
      relaxations,
    };
  }
  // 學年課的下半先接上；再補只有特定課能補的缺口（必修、核心、通識領域、本系選修），
  // 最後才看總缺口（TODO G4）
  const bestCont = solutions.reduce((m, s) => Math.min(m, s.score.missedContinuations), Number.POSITIVE_INFINITY);
  const continued = solutions.filter((s) => s.score.missedContinuations === bestCont);
  const bestSpecific = continued.reduce((m, s) => Math.min(m, s.score.unmetSpecific), Number.POSITIVE_INFINITY);
  const focused = continued.filter((s) => s.score.unmetSpecific === bestSpecific);
  const bestTotal = focused.reduce((m, s) => Math.min(m, s.score.unmetAfter), Number.POSITIVE_INFINITY);
  let complete = focused.filter((s) => s.score.unmetAfter === bestTotal);

  // 學期學分下限是學則的硬規定。只要湊得到，就一律交出達標的課表；
  // 真的湊不到（開課不夠）才退而求其次，並在 warnings 說明。
  const reachesMin = complete.filter((s) => s.score.belowTermMin === 0);
  if (reachesMin.length > 0) complete = reachesMin;

  // 「課排在 N 天內」是使用者畫的硬線（preferCompactDays 只是盡量）。排不進就照實說
  // 最少要幾天、是哪幾天，由使用者決定要不要放寬 —— 不自動放寬（§1.4）。
  //
  // 必須排在學期學分下限**之後**：學則的下限不能拿去換使用者的偏好。
  // 先前的版本順序相反，「把課集中在一天」會得到一份只有 2 門、6 學分的課表 ——
  // 塞進一天了，卻低於學則的 9 學分下限。
  //
  // 含時段未知課程的組合不算數：時段不知道就無法確認它也落在那幾天。
  // 否則時段未知的課不佔任何一天，等於免費塞進去 —— 實測 demo 的「把課集中在一天」
  // 就是靠一門時段未知的課（IM4065）湊滿 9 學分，標題卻宣稱「已把課排在 1 天內」。
  const maxDays = ctx.constraints.maxDays;
  if (maxDays !== undefined) {
    const verifiable = complete.filter((s) => !s.sel.some((c) => c.offering.slotsUnknown));
    const within = verifiable.filter((s) => s.score.dayCount <= maxDays);
    if (within.length === 0) {
      const why =
        reachesMin.length > 0
          ? `要補足未修學分並達到學則的學期學分下限 ${ctx.termMinCredits}`
          : "要補足未修學分";
      let suggestion: string;
      if (verifiable.length === 0) {
        suggestion = `${why}的組合都含時段未知的課，無法確認能不能排在 ${maxDays} 天內`;
      } else {
        const fewest = verifiable.reduce((a, b) => (b.score.dayCount < a.score.dayCount ? b : a));
        const days = [...new Set(fewest.sel.flatMap((c) => c.offering.slots.map((s) => s.day)))]
          .sort((a, b) => a - b)
          .map((d) => DAY_NAME[d]);
        suggestion = `${why}，課最少得排在 ${fewest.score.dayCount} 天（星期${days.join("、")}），排不進 ${maxDays} 天`;
      }
      return {
        ok: false,
        infeasibilities: [
          { category: "上課天數", candidatesBeforeFilter: complete.length, excludedBy: [], suggestion },
        ],
        excluded,
        relaxations,
      };
    }
    complete = within;
  }

  const obj = objectiveFor(ctx);
  // 規劃條件平手時，優先保留使用者眼前已經排好的課。
  // 少了這一步，每一輪都從頭挑、平手時照課號排序，使用者只說「多選一堂」，
  // 原本的 3 門卻被換掉 2 門 —— 條件沒有要求的變動，對使用者來說就是無緣無故。
  const keep = new Set(ctx.keep ?? []);
  const kept = (s: { sel: Candidate[] }) => s.sel.filter((c) => keep.has(c.offering.code)).length;
  const ranked = complete
    .sort(
      (a, b) =>
        // 規劃條件永遠優先；其次是少動使用者已經看到的課；契合度只在完全平手時才決定順序
        lexCompare(obj(a.score), obj(b.score)) ||
        kept(b) - kept(a) ||
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
  // 使用者明講要修到 N 堂時，N 堂以內「可有可無」的課就是他要的，不是贅餘。
  // 少了這條，「原本 3 門（剛好 9 學分）再加 1 門」永遠不是候選：求解器要湊到 4 門，
  // 只能改挑學分較小的課讓 4 門都變成必要 —— 使用者只說「多選一堂」，
  // 看到的卻是原本的課被換掉 2 門。
  const target = ctx.constraints.targetCourseCount;
  if (target !== undefined && sel.length <= target) return true;
  // 只需要缺口與學分下限，不算完整評分（每個節點要算好幾次，評分物件要組字串）
  const below = (cs: Candidate[]) => Math.max(0, ctx.termMinCredits - cs.reduce((a, c) => a + c.offering.credits, 0));
  const baseUnmet = shortfall(sel, ctx.requirements);
  const baseBelow = below(sel);
  for (let i = pinnedCount; i < sel.length; i++) {
    const without = sel.filter((_, j) => j !== i);
    if (shortfall(without, ctx.requirements) <= baseUnmet && below(without) <= baseBelow) return false;
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
    const target = ctx.constraints.targetCourseCount;
    if (target < s.courseCount) {
      const why =
        s.unmetAfter === 0 && s.belowTermMin === 0
          ? `要同時補足未修學分並達到學則的學期學分下限 ${ctx.termMinCredits}`
          : "要補足未修學分";
      warnings.push(`你期望 ${target} 堂課，但${why}，至少需要 ${s.courseCount} 堂。`);
    } else {
      // 期望比排得進的多：原本也寫「至少需要」，方向是反的
      warnings.push(
        `你期望 ${target} 堂課，但在目前條件下（學分上限、時段、衝堂與可選的開課）最多只排得進 ${s.courseCount} 堂。`,
      );
    }
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
    ...(c.offering.outline ? { section: c.offering.outline.id } : {}),
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
    (o) => meets(o, req),
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
        // 同一門課分好幾班會重複出現（輔大的國文有九十幾班），例子只列不同的課
        examples: [...new Set(list.map((e) => `${e.name}（${e.code}）`))].slice(0, 3),
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
 * 某一門課為什麼沒被排進來（docs/CONVERSATION.md §1.6）。
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
