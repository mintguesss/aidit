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
import { classAllows, sectionLetter, type ClassProfile } from "@/lib/offerings/class-group";

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
  /** 使用者要的主題課（wantOneOf）：優先試、不受各種上限刪掉 */
  wanted?: boolean;
  /** 本系甲乙班的哪一班（開課班級「資管二甲」→ 甲）；不分班的課沒有 */
  classSection?: "甲" | "乙";
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
  /** 使用者要的主題課（constraints.wantOneOf）這學期有開、也沒被排除的（求解時算出） */
  wantOffered?: Set<string>;
  /** 入學學年。配合 termLabel 算出排課那學期是大幾，高年級的必修不排給低年級 */
  admissionYear?: number;
  /** 學生的系所代號（與開課資料的 dept 同一套）。同一門課有本系保留的班時，只排本系的班 */
  studentDept?: string;
  /** 學生的系、學院、甲乙班：依開課班級判斷能修哪幾班（lib/offerings/class-group.ts，TODO C7） */
  classProfile?: ClassProfile;
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

const NODE_LIMIT = 300_000;
/** 搜尋時每組平手的解留幾個（見 dfs 裡的分組）；後面只取前 3 名 */
const BUCKET_KEEP = 3;

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
  /** 每門課所有可選的班（上限截掉之前），搜尋完換班用 */
  sections: Map<string, Candidate[]>;
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
  // 有本系保留班的課只排本系的班。輔大人生哲學一學期七十幾班，資管系自己的只有 2 班，
  // 其餘是開給別系的 —— 排到別系的班，學生選課時根本選不到。
  // 開課資料目前只有開課單位、沒有開課班級，所以只能做到「有本系的班就只用本系的」（TODO C7）
  const ownDeptCodes = new Set(
    ctx.studentDept ? ctx.offerings.filter((o) => o.dept === ctx.studentDept).map((o) => o.code) : [],
  );

  for (const o of [...ctx.offerings].sort((a, b) => cmp(a.code, b.code))) {
    const drop = (step: ExclusionReason["step"], reason: string) =>
      exclusions.push({ reason, code: o.code, name: o.name, step });

    // 別系的班不是「排除」：這門課本系的班照常是候選，所以不列在排除清單
    if (ownDeptCodes.has(o.code) && o.dept !== ctx.studentDept) continue;
    // 開課班級：別系專屬的全人課、別的學院的國文外文、另一個甲乙班 —— 學生選不到，不當候選（同上，不列排除）
    if (ctx.classProfile && !classAllows(o.classGroup, ctx.classProfile).ok) continue;

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
      classSection: ctx.classProfile ? sectionLetter(o.classGroup, ctx.classProfile) : undefined,
      ...(ctx.constraints.wantOneOf?.includes(o.code) ? { wanted: true } : {}),
      // 「這學期該修的課」：學年課的下半，以及規劃在這個年級（或更早、還沒修）的本系必修
      continues:
        (ctx.continueCodes?.has(o.code) ?? false) ||
        (studyYear !== undefined && o.forGrade !== undefined && o.forGrade <= studyYear),
    };
    if (satisfies.length > 0 || c.pinned || c.wanted) candidates.push(c);
    else fillers.push(c);
  }

  // 使用者眼前課表上的課不受下面兩道上限影響：被上限刷掉的話，「盡量保留原本的課」根本無從保留
  const keep = new Set(ctx.keep ?? []);
  // 使用者要的主題課也不受上限刪掉：「想修一堂 AI 相關的課」，刪掉了就排不出來
  const uncapped = (c: Candidate) => c.pinned || Boolean(c.wanted) || keep.has(c.offering.code);

  // 同一門課只留時段不同的幾班（指定保留的課不限）。
  // 以前留的是資料順序的前幾班，而資料依時段排序，留下來的幾乎都是星期一早上 ——
  // 「不排早八」因此找不到人生哲學的非早八班。改成先留非早八的，再盡量分散在不同天
  const capSections = (list: Candidate[]) => {
    const byCode = new Map<string, Candidate[]>();
    for (const c of list) byCode.set(c.offering.code, [...(byCode.get(c.offering.code) ?? []), c]);
    const chosen = new Set<Candidate>();
    for (const group of byCode.values()) {
      const distinct = [...new Map(group.filter((c) => !uncapped(c)).map((c) => [c.offering.rawSlotText ?? "", c])).values()]
        .sort((a, b) => Number(a.early) - Number(b.early));
      const days = new Set<number>();
      for (let n = 0; n < SECTION_LIMIT && distinct.length > 0; n++) {
        // 優先挑還沒涵蓋到的星期；都涵蓋過了就照順序（非早八在前）
        const i = Math.max(0, distinct.findIndex((c) => c.offering.slots.some((s) => !days.has(s.day))));
        const c = distinct.splice(i, 1)[0]!;
        for (const s of c.offering.slots) days.add(s.day);
        chosen.add(c);
      }
      for (const c of group) if (uncapped(c)) chosen.add(c);
    }
    return list.filter((c) => chosen.has(c));
  };
  // 對排課來說可以互換的課（補的需求一樣、學分一樣）只留前幾門。輔大一學期的通識上百門，
  // 同領域 2 學分的課彼此只差在時段與課名，全部放進搜尋只會撞到 NODE_LIMIT（大一的案例要 10 秒）。
  // 指定保留、學年課下半不受限
  // 以前照課號取前幾門，與使用者的條件無關；改成有非早八班的課優先
  const capClasses = (list: Candidate[]) => {
    const nonEarly = new Set(list.filter((c) => !c.early).map((c) => c.offering.code));
    const ordered = [...list].sort((a, b) => Number(nonEarly.has(b.offering.code)) - Number(nonEarly.has(a.offering.code)));
    const codesByClass = new Map<string, Set<string>>();
    const kept = new Set(
      ordered.filter((c) => {
        if (uncapped(c) || c.continues) return true;
        const key = `${[...c.satisfies].sort().join("|")}:${c.offering.credits}`;
        const codes = codesByClass.get(key) ?? new Set<string>();
        codesByClass.set(key, codes);
        if (codes.has(c.offering.code)) return true;
        if (codes.size >= CLASS_LIMIT) return false;
        codes.add(c.offering.code);
        return true;
      }),
    );
    return list.filter((c) => kept.has(c));
  };
  const sections = new Map<string, Candidate[]>();
  for (const c of [...candidates, ...fillers]) sections.set(c.offering.code, [...(sections.get(c.offering.code) ?? []), c]);
  return { candidates: capClasses(capSections(candidates)), fillers: capSections(fillers), exclusions, sections };

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
  /** 新加的課不是使用者要的學分數的門數（newCourseCredits） */
  creditMismatch: number;
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
/** 換班時每組課最多試幾種班的組合；超過就只用搜尋找到的那一組 */
const SECTION_COMBO_LIMIT = 20_000;

/**
 * 搜尋完之後，對每一組課重新挑班。
 *
 * 同一門課換一班，學分與採計類別都不變，只有時段相關的項目會變（早八、上課天數、衝堂）。
 * 搜尋把每一班當成獨立的候選，名額有限的節點大多花在「同一門課換一班」上：
 * 實測輔大大一「不排早八」，經濟學有下午的班，搜尋卻交出早八那班，
 * 節點上限開到 500 萬（55 秒）仍然找不到。這裡對同一組課把所有班的組合列出來挑最好的，
 * 對這組課來說是精確的。
 *
 * 每組課留兩個版本：目標函數最好的，以及上課天數最少的（「排在 N 天內」的篩選要用）
 */
function reassignSections(
  solutions: { sel: Candidate[]; score: Score }[],
  sections: Map<string, Candidate[]>,
  ctx: SolveContext,
  termParts: (cs: Candidate[]) => { total: number; specific: number },
): { sel: Candidate[]; score: Score }[] {
  const obj = objectiveFor(ctx);
  const better = (a: Score, b: Score) => lexCompare(obj(a), obj(b)) < 0;
  const out = new Map<string, { sel: Candidate[]; score: Score }>();
  const add = (s: { sel: Candidate[]; score: Score }) => {
    const id = `${s.score.key}#${s.sel.map((c) => c.offering.rawSlotText).join("|")}`;
    if (!out.has(id)) out.set(id, s);
  };
  const done = new Set<string>();
  for (const s of solutions) {
    add(s);
    if (done.has(s.score.key)) continue;
    done.add(s.score.key);
    const options = s.sel.map((c) => sections.get(c.offering.code) ?? [c]);
    if (options.reduce((n, o) => n * o.length, 1) > SECTION_COMBO_LIMIT) continue;

    const parts = termParts(s.sel);
    let best = s;
    let fewestDays = s;
    const pick: Candidate[] = [];
    const walk = (i: number) => {
      if (i === options.length) {
        const sc = score(pick, ctx, parts);
        if (better(sc, best.score)) best = { sel: [...pick], score: sc };
        if (sc.dayCount < fewestDays.score.dayCount) fewestDays = { sel: [...pick], score: sc };
        return;
      }
      for (const c of options[i]!) {
        if (pick.some((p) => !p.offering.slotsUnknown && !c.offering.slotsUnknown && clashes(p.offering.slots, c.offering.slots))) continue;
        if (c.classSection && pick.some((p) => p.classSection && p.classSection !== c.classSection)) continue;
        pick.push(c);
        walk(i + 1);
        pick.pop();
      }
    };
    walk(0);
    add(best);
    add(fewestDays);
  }
  return [...out.values()];
}

/** 一般修業年限的學期數（學士班四年）。延畢的學生剩餘學期以 1 計，也就是全部補完 */
const STANDARD_TERMS = 8;

/**
 * 這學期該補多少缺口（學分）。
 *
 * - 最快畢業：全部，能修多少修多少
 * - 正常進度：剩下的缺口平均分到剩下的學期，但不低於學則的學期下限
 * - 輕量：學期下限就好
 *
 * 不知道入學年或學期時無從算進度，退回「全部」（舊行為）
 */
function termShare(ctx: SolveContext): number {
  const all = Number.POSITIVE_INFINITY;
  if (ctx.preferences.goal === "asap") return all;
  if (ctx.preferences.goal === "light") return ctx.termMinCredits;
  const m = /^(\d{3})-([12])$/.exec(ctx.termLabel);
  if (!m || !ctx.admissionYear) return all;
  const nth = (Number(m[1]) - ctx.admissionYear) * 2 + Number(m[2]);
  const remaining = Math.max(1, STANDARD_TERMS - nth + 1);
  return Math.max(ctx.termMinCredits, Math.ceil(shortfallParts([], ctx.requirements).total / remaining));
}

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

function score(sel: Candidate[], ctx: SolveContext, parts = shortfallParts(sel, ctx.requirements)): Score {
  const totalCredits = sel.reduce((a, c) => a + c.offering.credits, 0);
  const days = new Set<number>();
  for (const c of sel) for (const s of c.offering.slots) days.add(s.day);
  const target = ctx.constraints.targetCourseCount;
  return {
    unmetAfter: parts.total,
    unmetSpecific: parts.specific,
    // 學年課下半沒接上的門數，加上使用者要的主題課這學期有開卻一門都沒排（算 1）
    missedContinuations:
      [...(ctx.continueOffered ?? [])].filter((code) => !sel.some((c) => c.offering.code === code)).length +
      ((ctx.wantOffered?.size ?? 0) > 0 && !sel.some((c) => ctx.wantOffered!.has(c.offering.code)) ? 1 : 0),
    creditMismatch:
      ctx.constraints.newCourseCredits === undefined
        ? 0
        : sel.filter((c) => !(ctx.keep ?? []).includes(c.offering.code) && c.offering.credits !== ctx.constraints.newCourseCredits).length,
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
  // 「多選一堂兩學分的課」：排在堂數之後 —— 先確定多一堂，再挑學分對的那一堂
  const cm = (s: Score) => s.creditMismatch;

  switch (p.goal) {
    // 最快畢業：補滿未修後盡量多修，並湊到學期下限
    case "asap":
      return (s) => [s.unmetAfter, gap(s), cm(s), s.belowTermMin, early(s), -s.totalCredits, compact(s), s.courseCount];
    // 這學期輕一點：堂數優先，其次才是早八與集中度
    case "light":
      return (s) => [s.unmetAfter, s.courseCount, gap(s), cm(s), early(s), compact(s), s.totalCredits];
    // 正常進度：先滿足時段偏好與期望堂數，再考慮學分下限
    case "balanced":
    default:
      return (s) => [s.unmetAfter, early(s), gap(s), cm(s), compact(s), s.belowTermMin, s.courseCount];
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
  ctx = {
    ...ctx,
    continueOffered: new Set([...candidates, ...fillers].filter((c) => c.continues).map((c) => c.offering.code)),
    wantOffered: new Set([...candidates, ...fillers].filter((c) => c.wanted).map((c) => c.offering.code)),
  };
  const excluded = summarize(exclusions, ctx.offerings.length);

  // 2. 某一類這學期沒有學生能修的班（沒開、或只開給別系，例如輔大專業倫理-企業倫理上學期只開給企管、會計…）：
  //    跳過這一類照排其他的，課表上說明。以前直接整份回報無解 —— 其他能排的課也不給，
  //    C7 前因為會排到別系的班（學生選不到）才沒露出來。所有類別都沒有能修的班才是真的無解
  const empty = ctx.requirements.filter((r) => !candidates.some((c) => c.satisfies.includes(r.id)));
  // 但被學生自己的條件擋掉的（空出某天、不要某門課、與已登記時段衝突…）不能跳過 ——
  // 那是條件互相衝突，要照 §1.4 回報並讓使用者決定放寬哪一個，不是「學校沒開」
  const BY_USER: ExclusionReason["step"][] = ["excluded-by-user", "avoid-day", "avoid-period", "clash-reserved", "no-seat", "prerequisite"];
  const blockedByUser = (r: Requirement) => {
    const codes = new Set(ctx.offerings.filter((o) => meets(o, r)).map((o) => o.code));
    return exclusions.some((e) => codes.has(e.code) && BY_USER.includes(e.step));
  };
  const unavailable = empty.filter((r) => !blockedByUser(r));
  if (unavailable.length > 0 && unavailable.length === empty.length && empty.length < ctx.requirements.length) {
    const rest = attemptSolve(
      { ...ctx, requirements: ctx.requirements.filter((r) => !empty.includes(r)) },
      preset,
      relaxations,
      allowPartial,
    );
    if (!rest.ok) return rest;
    const notes = empty.map(
      (r) => `「${r.shortLabel}」${ctx.termLabel} 沒有你能修的班（沒有開課，或只開給別系），這學期先不排，請留意下學期的開課。`,
    );
    for (const p of rest.plans) p.warnings = [...notes, ...p.warnings];
    return rest;
  }
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
    c.continues || c.wanted
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

  // 缺口只算「這學期該補的份」：比 termShare 多出來的缺口留給之後的學期，不算這份課表沒做到。
  // 以前算的是整個學位還缺多少，對還差一百多學分的學生永遠是修越多越好，
  // 「正常進度」「輕量」都被推到學分上限，只是被一學期最多 8 門的搜尋上限擋住才沒露餡
  const share = termShare(ctx);
  const base = shortfallParts([], ctx.requirements);
  const slack = { total: Math.max(0, base.total - share), specific: Math.max(0, base.specific - share) };
  const termParts = (cs: Candidate[]) => {
    const p = shortfallParts(cs, ctx.requirements);
    return { total: Math.max(0, p.total - slack.total), specific: Math.max(0, p.specific - slack.specific) };
  };

  const gainFactor = ctx.requirements.some((r) => isSub(r) && r.minCredits > 0) ? 2 : 1;
  const buckets = new Map<string, { sel: Candidate[]; score: Score }[]>();
  const keepSet = new Set(ctx.keep ?? []);
  const keptCount = (cs: Candidate[]) => cs.filter((c) => keepSet.has(c.offering.code)).length;
  let bestKey: [number, number, number] = [Infinity, Infinity, Infinity];
  /** 所有組合裡最小的總缺口（無解判定用；去掉贅餘的課不會改變它，所以不必先做贅餘檢查） */
  let minTotal = Number.POSITIVE_INFINITY;
  const continueOffered = [...(ctx.continueOffered ?? [])];
  // 主題課（「想修一堂 AI 相關的課」）跟學年課下半同一級：這學期有開就要有一門
  const wantOffered = (ctx.wantOffered?.size ?? 0) > 0;
  const missedWant = (cs: Candidate[]) => (wantOffered && !cs.some((c) => c.wanted) ? 1 : 0);
  const missedOf = (cs: Candidate[]) =>
    continueOffered.filter((code) => !cs.some((c) => c.offering.code === code)).length + missedWant(cs);
  const sel: Candidate[] = [...pinnedCandidates];
  let nodes = 0;
  let truncated = false;

  // 分支定界用（TODO G7）：從第 i 個候選往後，還拿得到哪些「該修的課」、最多還能補多少特定缺口
  const isSpecific = (c: Candidate) =>
    [...c.creditIdx, ...c.domainIdx].some((k) => !ctx.requirements[k]!.catchAll || isSub(ctx.requirements[k]!));
  const contAfter: Set<string>[] = new Array(sorted.length + 1);
  const wantAfter = new Array<boolean>(sorted.length + 1).fill(false);
  for (let k = sorted.length - 1; k >= 0; k--) wantAfter[k] = wantAfter[k + 1]! || Boolean(sorted[k]!.wanted);
  const specificAfter = new Array<number>(sorted.length + 1).fill(0);
  contAfter[sorted.length] = new Set();
  for (let k = sorted.length - 1; k >= 0; k--) {
    const c = sorted[k]!;
    contAfter[k] = c.continues ? new Set([...contAfter[k + 1]!, c.offering.code]) : contAfter[k + 1]!;
    specificAfter[k] = specificAfter[k + 1]! + (isSpecific(c) ? c.offering.credits : 0);
  }

  const dfs = (i: number, credits: number): void => {
    if (truncated) return;
    if (++nodes > NODE_LIMIT) {
      truncated = true;
      return;
    }
    const parts = termParts(sel);
    if (sel.length > 0) {
      // 邊搜邊比：後面挑解只看（漏接的該修課、特定缺口、總缺口）最好的那一群，
      // 比目前最好的差就不必存、也不必做贅餘檢查與完整評分。挑出來的結果與全部存下來再挑相同
      minTotal = Math.min(minTotal, parts.total);
      const missed = missedOf(sel);
      const cmpKey = missed - bestKey[0] || parts.specific - bestKey[1] || parts.total - bestKey[2];
      if (cmpKey <= 0) {
        // 平手的解依「後面排序與篩選會看的每一項」分組，每組只留課號串最小的 3 組。
        // 同組的解在後面每一步都平手、只差最後的課號決勝，所以留下的前 3 名與全部留著完全相同。
        // 補到這學期份量的組合可以有十幾萬組（輔大大一），每組都做贅餘檢查要 10 秒
        const sc = score(sel, ctx, parts);
        const b =
          `${sc.earlyMorningCount}|${sc.dayCount}|${sc.courseCount}|${sc.totalCredits}|${sc.belowTermMin}|` +
          `${sc.countGap}|${sc.creditMismatch}|${sc.affinity}|${keptCount(sel)}|${sel.some((c) => c.offering.slotsUnknown)}`;
        const group = cmpKey < 0 ? [] : (buckets.get(b) ?? []);
        const full = group.length >= BUCKET_KEEP && group.every((g) => cmp(g.score.key, sc.key) < 0);
        // 只有不贅餘的解能刷新最佳值：贅餘的解若先清掉其他組，最後可能一組都不剩
        if (!full && isIrredundant(sel, ctx, pinnedCandidates.length)) {
          if (cmpKey < 0) {
            buckets.clear();
            bestKey = [missed, parts.specific, parts.total];
          }
          group.push({ sel: [...sel], score: sc });
          group.sort((x, y) => cmp(x.score.key, y.score.key));
          if (group.length > BUCKET_KEEP) group.pop();
          buckets.set(b, group);
        }
      }
    }
    if (i >= sorted.length) return;

    // 剪枝：這學期的份已經補到、學期下限與期望堂數也都到了，再加課只會更差 ——
    // 正常進度與輕量的目標函數接下來比的早八數、上課天數、堂數、學分，加一門課都只增不減。
    // 少了這條，補到份量的組合全部平手，每一組都要做贅餘檢查與評分，輔大一次求解從 1 秒變 10 秒
    const target = ctx.constraints.targetCourseCount;
    if (
      share !== Number.POSITIVE_INFINITY &&
      sel.length > 0 &&
      parts.total === 0 &&
      parts.specific === 0 &&
      missedOf(sel) === 0 &&
      credits >= ctx.termMinCredits &&
      (target === undefined || sel.length >= target)
    ) {
      return;
    }

    // 剪枝：剩餘候選可提供學分 < 尚缺學分
    // 以學分計的領域需求：一門通識同時補通識學分和該領域，最多能減掉兩倍學分
    if (parts.total > gainFactor * suffix[i]! + DOMAIN_WEIGHT * ctx.requirements.length) return;

    // 分支定界（TODO G7）：這條路最樂觀的結果都比已找到的差，就不必再往下。
    // 最樂觀＝後面還拿得到的「該修的課」全部接上、能補特定缺口的課全部加上（且每學分都算兩倍）。
    // 只剪「嚴格比較差」的分支，平手的照留 —— 結果與不剪相同，只是同樣的節點上限能看得更遠。
    // 以前輔大每一次排課都撞到 30 萬個節點的上限，大二的課表因此多跑一天、大三少排一門
    if (bestKey[0] !== Infinity) {
      const lbMissed =
        continueOffered.filter((code) => !sel.some((c) => c.offering.code === code) && !contAfter[i]!.has(code)).length +
        (missedWant(sel) && !wantAfter[i] ? 1 : 0);
      if (lbMissed > bestKey[0]) return;
      const lbSpecific = Math.max(0, parts.specific - gainFactor * specificAfter[i]! - DOMAIN_WEIGHT * ctx.requirements.length);
      if (lbMissed === bestKey[0] && lbSpecific > bestKey[1]) return;
    }

    for (let j = i; j < sorted.length; j++) {
      const c = sorted[j]!;
      // 剪枝：已選學分 > maxCredits
      if (credits + c.offering.credits > maxCredits) continue;
      // 同一門課分好幾班（輔大的微積分有甲、乙兩班，同一個課號、不同時段），
      // 一份課表只能選其中一班。合成資料沒有多班的課，這條以前從沒被觸發過
      if (sel.some((s) => s.offering.code === c.offering.code)) continue;
      // 不知道學生是甲班還是乙班時，同一份課表的本系課要在同一班（不會統計學甲班、經濟學乙班）
      if (c.classSection && sel.some((s) => s.classSection && s.classSection !== c.classSection)) continue;
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
  const solutions = reassignSections([...buckets.values()].flat(), filtered.sections, ctx, termParts);

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
  const want = ctx.constraints.wantOneOf;
  if (want?.length && !(ctx.wantOffered?.size ?? 0)) {
    warnings.push(`${ctx.termLabel} 沒有你能修的「${ctx.constraints.wantLabel ?? "指定主題"}」課程（沒有開課、開給別系、或與你的條件衝突）。`);
  }
  const wantCredits = ctx.constraints.newCourseCredits;
  if (wantCredits !== undefined && s.creditMismatch > 0) {
    warnings.push(`新加的課找不到排得進的 ${wantCredits} 學分課程，改排其他學分數的課。`);
  }
  if (s.belowTermMin > 0) {
    warnings.push(
      `合計 ${s.totalCredits} 學分，未達學則的學期學分下限 ${ctx.termMinCredits} 學分 —— ` +
        `${ctx.termLabel} 可選的開課不足以湊到下限。請洽系辦確認是否可專案申請低於下限修課。`,
    );
  }
  if (s.unmetAfter > 0) {
    // unmetAfter 是「這學期該補的份」還差多少（見 termShare），不是整個學位還差多少
    warnings.push(`這學期該補的學分還差 ${s.unmetAfter} 學分，${ctx.termLabel} 可選的開課補不齊。`);
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
