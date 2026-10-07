import type {
  AuditResult,
  CategoryResult,
  Citation,
  CourseRecord,
  Declarations,
  GraduationCheck,
  HoldItem,
  StudentRecord,
  SubRuleResult,
  Verdict,
} from "@/lib/types";
import type { RuleAmbiguity, RuleCategory, RuleCitation, RulePack } from "@/lib/rules/schema";
import { courseNameMatches, normalizeName } from "@/lib/courses/names";
import { assign, type AssignableCourse, type CategoryDemand, type AssignmentResult } from "./assign";
import { cmp } from "@/lib/util/text";

/**
 * 確定性學分比對（docs/SPEC.md §6 step 5）。
 *
 * 本檔任何情況下都不得呼叫 LLM。學分加總是確定性運算，
 * 這是整個系統「不幻覺」的技術保證，CI 會掃描本檔的 import。
 */

// ------------------------------------------------------------------ 輸入

export type ConflictNote = {
  /** 類別 id 或畢業條件 id */
  target: string;
  text: string;
  citations: Citation[];
};

export type DeptDefinedResolution = {
  resolved: boolean;
  detail: string;
  citations: Citation[];
  /** 未解消時的建議洽詢單位與已檢索來源 */
  searchedSources?: string[];
};

export type AuditInput = {
  record: StudentRecord;
  pack: RulePack;
  traceId: string;
  currentTerm: string;
  nextTerm: string;
  /** 已解消之規則衝突，寫進對應類別的依據 */
  conflictNotes?: ConflictNote[];
  /** rule = deptDefined 的畢業條件解消結果 */
  deptDefinedResolutions?: Record<string, DeptDefinedResolution>;
  /** 現行有開課的課號，用於判斷抵免課號是否已停開 */
  activeCourseCodes?: Set<string>;
  /** 學生自行勾選已通過的畢業條件（只用在學校資料看不出來的條件上） */
  declarations?: Declarations;
};

export class InvariantError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, number>,
  ) {
    super(message);
    this.name = "InvariantError";
  }
}

// ------------------------------------------------------------ 修課紀錄整理

type Prepared = {
  /** 進入指派問題的課程 */
  assignable: AssignableCourse[];
  /** 命中 ambiguity trigger、整個移出指派問題的課程 */
  held: { course: CourseRecord; ambiguity: RuleAmbiguity; category: RuleCategory }[];
  /** 重複採計而被剔除的紀錄，寫進 notes */
  deduped: CourseRecord[];
  /** 不計學分者（不及格、停修） */
  excluded: CourseRecord[];
  byKey: Map<string, CourseRecord>;
};

const termRank = (t: CourseRecord["term"]) => (t === 1 ? 1 : t === 2 ? 2 : 3);

/** 舊課號對照後的有效課號 */
const effectiveCode = (c: CourseRecord) => c.equivalentOf ?? c.code;

function recordKey(c: CourseRecord, i: number): string {
  return `${c.code}#${c.year}-${String(c.term)}#${i}`;
}

/**
 * 重補修同一門不得重複採計（學則第 23 條）。
 * 決勝：先取及格／抵免者，其次學年學期較早者，最後課號。
 *
 * 全學年課程（`pack.yearLongCourses`）例外：上、下學期共用一個課號，各是一半學分，
 * 不是重修。少了這個例外，下學期那一筆會被當成重修丟掉，算出假的未修 ——
 * 輔大的微積分、會計學、統計學、經濟學都是這樣。
 *
 * 這類課每一半各留一筆最好的；某一半在正規學期沒有紀錄時，才拿暑修那一筆補上
 * （暑修多半就是補修沒過的那一半）。**每門最多採計兩筆**：上、下、暑修三筆都留，
 * 會把一門課算成一門半，那是往另一個方向的錯答 —— 學生會以為自己學分夠了。
 */
function dedupe(
  courses: CourseRecord[],
  yearLong: ReadonlySet<string>,
): { kept: CourseRecord[]; dropped: CourseRecord[] } {
  const groups = new Map<string, CourseRecord[]>();
  for (const c of courses) {
    // 沒有課號的紀錄（輔大成績單只有課名；國文、外國語文分組上課，規劃表也不列課號）：
    // 只把同課名、同學期的當成重複。跨學期分不出是重修還是上下學期接著修，
    // 合併會把學分吃掉 —— 學生會被判少修，所以寧可不合併
    const code = effectiveCode(c);
    const k = code !== "" ? code : `\u0000${normalizeName(c.name)}\u0000${c.year}-${c.term}`;
    const list = groups.get(k) ?? [];
    list.push(c);
    groups.set(k, list);
  }
  const rank = (c: CourseRecord) =>
    c.status === "passed" || c.status === "waived" ? 0 : c.status === "in_progress" ? 1 : 2;
  const best = (a: CourseRecord, b: CourseRecord) =>
    rank(a) - rank(b) || a.year - b.year || termRank(a.term) - termRank(b.term) || cmp(a.code, b.code);

  const kept: CourseRecord[] = [];
  const dropped: CourseRecord[] = [];
  for (const [code, list] of groups) {
    if (list.length === 1) {
      kept.push(list[0]!);
      continue;
    }
    const sorted = [...list].sort(best);

    if (!yearLong.has(code)) {
      kept.push(sorted[0]!);
      dropped.push(...sorted.slice(1));
      continue;
    }

    const picked: CourseRecord[] = [];
    for (const half of [1, 2] as const) {
      const regular = sorted.find((c) => c.term === half);
      const summer = sorted.find((c) => c.term === "summer" && !picked.includes(c));
      const chosen = regular ?? summer;
      if (chosen) picked.push(chosen);
    }
    kept.push(...picked);
    dropped.push(...sorted.filter((c) => !picked.includes(c)));
  }
  return { kept, dropped };
}


function matches(cat: RuleCategory, c: CourseRecord, pack: RulePack): boolean {
  const code = effectiveCode(c);
  switch (cat.match.type) {
    case "courseList":
      return cat.match.codes.includes(code);
    case "courseNames":
      return courseNameMatches(cat.match, c.name);
    case "selectType":
      return c.selectType === cat.match.value;
    case "deptElective":
      if (cat.match.excludeNames?.some((n) => normalizeName(n) === normalizeName(c.name))) return false;
      return c.selectType === "elective" && (c.offeringDept ?? pack.dept) === cat.match.dept;
    case "anyPassed":
      return true;
  }
}

/**
 * 候選類別集合。
 *
 * courseList 具排他性：列在必修科目表上的課只能歸該類別，
 * 否則每一門必修都會同時符合 anyPassed（自由選修），把搜尋空間毫無意義地撐大。
 * courseNames 是同一種東西（科目表上的課，只是沒有課號），同樣具排他性。
 */
const isListed = (cat: RuleCategory) =>
  (cat.match.type === "courseList" && !cat.match.shared) || cat.match.type === "courseNames";

/**
 * 超修不計入畢業學分的類別（overflowPolicy.countsToTotal = false）同樣具排他性。
 *
 * 輔大：「超修的全人教育課程…之學分數皆不可列入畢業學分」。通識是用選別比對的，
 * 一門通識同時也符合「其他選修」（任何及格的課）—— 不排他的話，多修的通識會被塞進其他選修，
 * 剛好差幾學分的學生就會被誤判可以畢業。排他之後，多的就是那一類裡不計的超修。
 */
const isExclusive = (cat: RuleCategory, pack: RulePack) =>
  isListed(cat) || pack.overflowPolicy[cat.id]?.countsToTotal === false;

/** 一筆修課可以算進哪些類別。排課時也用它判斷開課資料算哪一類（lib/offerings 的 categoriesFor） */
export function eligibleCategories(c: CourseRecord, pack: RulePack): string[] {
  const listed = pack.categories.filter((cat) => isExclusive(cat, pack) && matches(cat, c, pack));
  if (listed.length > 0) return listed.map((cat) => cat.id);
  return pack.categories.filter((cat) => matches(cat, c, pack)).map((cat) => cat.id);
}

function triggerHits(
  amb: RuleAmbiguity,
  c: CourseRecord,
  pack: RulePack,
  activeCodes: Set<string>,
): boolean {
  switch (amb.trigger.type) {
    case "courseFromOtherCollege":
      return c.selectType === "elective" && !!c.offeringCollege && c.offeringCollege !== pack.college;
    case "courseFromOtherDept":
      return c.selectType === "elective" && !!c.offeringDept && c.offeringDept !== pack.dept;
    case "waiverWithoutMapping":
    case "retiredCourseCode": {
      if (c.status !== "waived" && amb.trigger.type === "waiverWithoutMapping") return false;
      const code = effectiveCode(c);
      if (c.equivalentOf) return false;
      // 以課名列在科目表上的課同樣算「有對照」，否則每一筆分組上課的國文都會被當成停開課號
      const inList = pack.categories.some(
        (cat) => (cat.match.type === "courseList" || cat.match.type === "courseNames") && matches(cat, c, pack),
      );
      return !inList && !activeCodes.has(code);
    }
    case "generalDomain":
      return c.generalDomain === amb.trigger.domain;
  }
}

/**
 * 排課用：這門課會不會一修就落到待確認（依領域觸發的規則缺口）。
 * 會的話不能拿來湊任何類別 —— 排進課表等於建議學生去修一門採計方式還不確定的課。
 * 其他觸發條件（外系、跨院）只影響已修的課怎麼採計，不在這裡擋。
 */
export function heldForPlanning(c: CourseRecord, pack: RulePack): RuleAmbiguity | undefined {
  for (const cat of pack.categories) {
    for (const amb of cat.ambiguities) {
      if (amb.trigger.type === "generalDomain" && triggerHits(amb, c, pack, new Set())) return amb;
    }
  }
  return undefined;
}

function prepare(input: AuditInput): Prepared {
  const { record, pack } = input;
  const activeCodes = input.activeCourseCodes ?? new Set<string>();

  const counted = record.courses.filter(
    (c) => c.status === "passed" || c.status === "waived" || c.status === "in_progress",
  );
  const excluded = record.courses.filter((c) => c.status === "failed" || c.status === "withdrawn");

  // 學年課：規則包列的，加上修課紀錄自己帶的標記（學校課程資料標「學年」的，見 CourseRecord.yearLong）。
  // 國文、外國語文分組上課、各級別課號不同，規則包列不完 —— 但學校的課程資料知道
  const yearLong = new Set([...pack.yearLongCourses, ...counted.filter((c) => c.yearLong).map(effectiveCode)]);
  const { kept, dropped } = dedupe(counted, yearLong);

  const assignable: AssignableCourse[] = [];
  const held: Prepared["held"] = [];
  const byKey = new Map<string, CourseRecord>();

  kept.forEach((c, i) => {
    const key = recordKey(c, i);
    byKey.set(key, c);

    // 命中 ambiguity trigger 的課程整個移出指派問題（docs/BACKEND.md §1）
    let hit: { ambiguity: RuleAmbiguity; category: RuleCategory } | null = null;
    for (const cat of pack.categories) {
      for (const amb of cat.ambiguities) {
        if (triggerHits(amb, c, pack, activeCodes)) {
          hit = { ambiguity: amb, category: cat };
          break;
        }
      }
      if (hit) break;
    }
    if (hit) {
      held.push({ course: c, ambiguity: hit.ambiguity, category: hit.category });
      return;
    }

    const eligible = eligibleCategories(c, pack);
    if (eligible.length === 0) return;
    assignable.push({
      key,
      code: effectiveCode(c),
      credits: c.credits,
      year: c.year,
      term: c.term,
      kind: c.status === "in_progress" ? "inProgress" : "earned",
      eligible,
    });
  });

  return { assignable, held, deduped: dropped, excluded, byKey };
}

// ---------------------------------------------------------------- 類別結果

type CategoryTally = {
  earned: number;
  inProgress: number;
  unmet: number;
  overflow: number;
  overflowInProgress: number;
  rawEarned: number;
};

/**
 * 由指派結果算出各類別的可採計、修課中、未修、超修。
 *
 * 超修一律不得補其他類別的未修 —— 這是 UI 上「123 學分卻還不能畢業」的來源，
 * 必須在引擎層保證，而不是交給前端說明文字。
 */
function tally(required: number, filledEarned: number, filledInProgress: number): CategoryTally {
  const earned = Math.min(filledEarned, required);
  const overflow = filledEarned - earned;
  const inProgress = Math.min(filledInProgress, required - earned);
  const overflowInProgress = filledInProgress - inProgress;
  const unmet = required - earned - inProgress;
  return { earned, inProgress, unmet, overflow, overflowInProgress, rawEarned: filledEarned };
}

function toCitation(c: RuleCitation, pack: RulePack): Citation {
  const doc = pack.documents.find((d) => d.id === c.docId);
  return {
    docId: c.docId,
    docTitle: doc?.title ?? c.docId,
    locator: c.locator,
    quote: c.quote,
    url: doc?.url,
    publishedAt: doc?.publishedAt,
  };
}

function domainCoverage(
  sub: Extract<RuleCategory["subRules"][number], { type: "domainCoverage" }>,
  courses: CourseRecord[],
  pack: RulePack,
): SubRuleResult {
  // 以學分判定（有設 minCreditsPerDomain）或以門數判定。兩者都把修課中的另外算，
  // 修課中的加上去夠了就是「成績登錄後始滿足」，不夠就是真的缺
  const byCredits = sub.minCreditsPerDomain !== undefined;
  const need = sub.minCreditsPerDomain ?? sub.minPerDomain;
  const items = sub.domains.map((d) => {
    const inDomain = courses.filter((c) => c.generalDomain === d);
    const measure = (cs: CourseRecord[]) => (byCredits ? cs.reduce((a, c) => a + c.credits, 0) : cs.length);
    const done = measure(inDomain.filter((c) => c.status === "passed" || c.status === "waived"));
    const doing = measure(inDomain.filter((c) => c.status === "in_progress"));
    const ok = done >= need;
    const progress = byCredits ? `已修 ${done}／${need} 學分` : undefined;
    return {
      label: d,
      ok,
      note: !ok && done + doing >= need ? "修課中" : !ok ? progress : undefined,
      ...(byCredits && !ok ? { shortBy: need - done - doing } : {}),
    };
  });
  const missing = items.filter((i) => !i.ok && i.note !== "修課中").map((i) => i.label);
  const pending = items.filter((i) => !i.ok && i.note === "修課中").map((i) => i.label);
  const status: SubRuleResult["status"] =
    missing.length > 0 ? "unmet" : pending.length > 0 ? "pending_in_progress" : "satisfied";
  const NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const rule = `${NUM[sub.domains.length] ?? sub.domains.length}大領域各至少 ${need} ${byCredits ? "學分" : "門"}`;
  const detail =
    missing.length > 0
      ? `${rule}；尚缺 ${missing.join("、")} 領域。`
      : pending.length > 0
        ? `${rule}；${pending.join("、")} 領域修課中，成績登錄後始滿足。`
        : `${rule}，全數滿足。`;
  return { id: sub.id, name: sub.name, status, detail, items, citations: [toCitation(sub.citation, pack)] };
}

// ---------------------------------------------------------------- 主流程

export function auditCredits(input: AuditInput): AuditResult {
  const { record, pack } = input;
  const prepared = prepare(input);

  const demands: CategoryDemand[] = pack.categories.map((c) => ({
    id: c.id,
    required: c.credits,
    order: c.order,
    catchAll: c.match.type === "anyPassed",
  }));

  const main = assign(prepared.assignable, demands);

  // 待確認項若被認定可採計，結果會如何 —— HoldItem 的 impact 欄位需要，故跑第二次指派
  const alternative = prepared.held.length > 0 ? assignWithHeld(prepared, demands, pack) : null;

  const notesByTarget = new Map<string, ConflictNote[]>();
  for (const n of input.conflictNotes ?? []) {
    notesByTarget.set(n.target, [...(notesByTarget.get(n.target) ?? []), n]);
  }

  const generalCourses = prepared.assignable
    .map((a) => prepared.byKey.get(a.key)!)
    .filter((c) => c.selectType === "general");

  const categories: CategoryResult[] = pack.categories.map((cat) => {
    const f = main.filled.get(cat.id) ?? { earned: 0, inProgress: 0 };
    const t = tally(cat.credits, f.earned, f.inProgress);

    const assignedHere = [...main.byCourse.entries()]
      .filter(([, id]) => id === cat.id)
      .map(([key]) => prepared.byKey.get(key)!);
    const subRules = cat.subRules.map((s) =>
      s.type === "domainCoverage"
        ? domainCoverage(s, generalCourses, pack)
        : s.type === "minDeptCredits"
          ? minDeptCredits(s, assignedHere, pack)
          : minCoursesFromList(s, prepared, pack),
    );

    const notes: string[] = [];
    if (t.overflow > 0) {
      const policy = pack.overflowPolicy[cat.id];
      notes.push(
        policy?.countsToTotal
          ? `超修 ${t.overflow} 學分，計入修得總學分但不得流用至其他類別。`
          : `超修 ${t.overflow} 學分，不計入畢業學分。`,
      );
    }
    if (t.overflowInProgress > 0) {
      notes.push(`修課中另有 ${t.overflowInProgress} 學分超出本類別應修學分，成績登錄後列為超修。`);
    }
    const conflictNotes = notesByTarget.get(cat.id) ?? [];
    for (const n of conflictNotes) notes.push(n.text);

    const citations: Citation[] = [toCitation(cat.citation, pack)];
    if (t.overflow > 0 && pack.overflowPolicy[cat.id]) {
      citations.push(toCitation(pack.overflowPolicy[cat.id]!.citation, pack));
    }
    for (const n of conflictNotes) citations.push(...n.citations);

    const subUnmet = subRules.some((s) => s.status === "unmet");
    const subPending = subRules.some((s) => s.status === "pending_in_progress");
    const status: CategoryResult["status"] =
      t.unmet > 0 || subUnmet
        ? "unmet"
        : t.inProgress > 0 || subPending
          ? "pending_in_progress"
          : "satisfied";

    const assignedCodes = [...main.byCourse.entries()]
      .filter(([, id]) => id === cat.id)
      .map(([key]) => prepared.byKey.get(key)!.code)
      .sort(cmp);

    return {
      id: cat.id,
      name: cat.name,
      shortName: cat.shortName,
      required: cat.credits,
      earned: t.earned,
      inProgress: t.inProgress,
      unmet: t.unmet,
      overflow: t.overflow,
      status,
      subRules,
      citations,
      notes,
      assignedCodes,
      ...(cat.match.type === "anyPassed" ? { catchAll: true } : {}),
    };
  });

  const countable = categories.reduce((a, c) => a + c.earned, 0);
  const inProgress = categories.reduce((a, c) => a + c.inProgress, 0);
  const unmet = categories.reduce((a, c) => a + c.unmet, 0);
  const overflow = categories.reduce((a, c) => a + c.overflow, 0);
  const totalEarned = countable + overflow;

  // ---- 不變式（docs/SPEC.md §3）。失敗即中止，絕不輸出可能錯誤的結果 ----
  if (countable + inProgress + unmet !== pack.minCredits) {
    throw new InvariantError("countable + inProgress + unmet !== minCredits", {
      countable,
      inProgress,
      unmet,
      minCredits: pack.minCredits,
    });
  }
  if (totalEarned !== countable + overflow) {
    throw new InvariantError("totalEarned !== countable + overflow", { totalEarned, countable, overflow });
  }

  const holds = buildHolds(prepared, alternative, main, pack, input);
  const graduationChecks = buildGraduationChecks(input, pack, holds);
  const verdict = buildVerdict({ pack, categories, countable, inProgress, unmet, overflow, totalEarned, graduationChecks, holds });

  return {
    traceId: input.traceId,
    rulePack: {
      id: pack.id,
      version: pack.version,
      approvedAt: pack.approvedAt,
      provenance: pack.provenance,
    },
    student: record.student,
    fetchedAt: record.fetchedAt,
    minCredits: pack.minCredits,
    totalEarned,
    countable,
    inProgress,
    unmet,
    overflow,
    categories,
    graduationChecks,
    holds,
    verdict,
    currentTerm: input.currentTerm,
    nextTerm: input.nextTerm,
  };
}

/** 這一類採計的課裡，指定系所開的選修有幾學分（輔大「選修中包含本系專業選修至少 10 學分」） */
function minDeptCredits(
  sub: Extract<RuleCategory["subRules"][number], { type: "minDeptCredits" }>,
  assigned: CourseRecord[],
  pack: RulePack,
): SubRuleResult {
  // 與 deptElective 同一條判斷：選別是選修、開課單位是該系（沒寫開課單位視為本系）
  const fromDept = assigned.filter((c) => c.selectType === "elective" && (c.offeringDept ?? pack.dept) === sub.dept);
  const sum = (cs: CourseRecord[]) => cs.reduce((a, c) => a + c.credits, 0);
  const done = sum(fromDept.filter((c) => c.status === "passed" || c.status === "waived"));
  const doing = sum(fromDept.filter((c) => c.status === "in_progress"));
  const ok = done >= sub.minCredits;
  const pending = !ok && done + doing >= sub.minCredits;
  return {
    id: sub.id,
    name: sub.name,
    status: ok ? "satisfied" : pending ? "pending_in_progress" : "unmet",
    detail: ok
      ? `至少 ${sub.minCredits} 學分，已修 ${done} 學分，滿足。`
      : pending
        ? `至少 ${sub.minCredits} 學分，已修 ${done} 學分，修課中 ${doing} 學分，成績登錄後始滿足。`
        : `至少 ${sub.minCredits} 學分，已修 ${done} 學分${doing ? `、修課中 ${doing} 學分` : ""}，還差 ${sub.minCredits - done - doing} 學分。`,
    items: [
      {
        label: sub.name,
        ok,
        note: pending ? "修課中" : ok ? undefined : `已修 ${done}／${sub.minCredits} 學分`,
        ...(ok || pending ? {} : { shortBy: sub.minCredits - done - doing }),
        dept: sub.dept,
      },
    ],
    citations: [toCitation(sub.citation, pack)],
  };
}

function minCoursesFromList(
  sub: Extract<RuleCategory["subRules"][number], { type: "minCoursesFromList" }>,
  prepared: Prepared,
  pack: RulePack,
): SubRuleResult {
  const hit = prepared.assignable.filter((a) => sub.codes.includes(a.code));
  const ok = hit.length >= sub.minCourses;
  return {
    id: sub.id,
    name: sub.name,
    status: ok ? "satisfied" : "unmet",
    detail: `指定科目至少 ${sub.minCourses} 門，已修 ${hit.length} 門。`,
    citations: [toCitation(sub.citation, pack)],
  };
}

/** 第二次指派：把待確認課程依 ambiguity 的宣告類別放回去，算出「若被認定可採計」的結果 */
function assignWithHeld(prepared: Prepared, demands: CategoryDemand[], pack: RulePack): AssignmentResult {
  const extra: AssignableCourse[] = prepared.held.map((h, i) => ({
    key: `held#${i}`,
    code: effectiveCode(h.course),
    credits: h.course.credits,
    year: h.course.year,
    term: h.course.term,
    kind: h.course.status === "in_progress" ? "inProgress" : "earned",
    eligible:
      h.ambiguity.affects === "thisCategory"
        ? [h.category.id]
        : pack.categories.filter((c) => matches(c, h.course, pack)).map((c) => c.id),
  }));
  return assign([...prepared.assignable, ...extra], demands);
}

function buildHolds(
  prepared: Prepared,
  alternative: AssignmentResult | null,
  main: AssignmentResult,
  pack: RulePack,
  input: AuditInput,
): HoldItem[] {
  const holds: HoldItem[] = [];

  // 依 ambiguity 分組：同一條規則的洞產生一則待確認事項，不逐課洗版
  const groups = new Map<string, Prepared["held"]>();
  for (const h of prepared.held) {
    const list = groups.get(h.ambiguity.id) ?? [];
    list.push(h);
    groups.set(h.ambiguity.id, list);
  }

  for (const [ambId, list] of [...groups.entries()].sort(([a], [b]) => cmp(a, b))) {
    const { ambiguity, category } = list[0]!;
    const names = list.map((h) => `「${h.course.name}」`).join("、");
    const credits = list.reduce((a, h) => a + h.course.credits, 0);

    const title =
      ambiguity.affects === "thisCategory"
        ? list.length === 1
          ? `跨院選修${names}是否採計為${category.name}`
          : `${list.length} 門跨院選修是否採計為${category.name}`
        : `抵免科目對照關係無法確認`;

    const impact = describeImpact(category.id, main, alternative, pack, credits, ambiguity.affects);

    const body =
      `${ambiguity.description}。` +
      `涉及科目：${list
        .map((h) => `${h.course.name}（${h.course.code}，${h.course.credits} 學分）`)
        .join("、")}。` +
      `已檢索 ${ambiguity.searchedSources.join("、")}，均查無可據以判定之補充說明，系統停止自動推論。`;

    holds.push({
      id: `hold-${ambId}`,
      title,
      body,
      citations: [toCitation(ambiguity.citation, pack)],
      impact,
      contact: ambiguity.contact,
      affectedCategory: ambiguity.affects === "thisCategory" ? category.id : undefined,
    });
  }

  // 畢業條件 deptDefined 未解消者
  for (const g of pack.graduationChecks) {
    if (g.rule !== "deptDefined") continue;
    const r = input.deptDefinedResolutions?.[g.id];
    if (r?.resolved) continue;
    holds.push({
      id: `hold-check-${g.id}`,
      title: `${g.name}檢定標準查無適用本學年度之明文`,
      body:
        r?.detail ??
        (g.holdDetail ? `${g.holdDetail}已檢索 ${(g.searchedSources.length > 0 ? g.searchedSources : ["系網公告"]).join("、")}。` : undefined) ??
        `課程規劃表就${g.name}記載「各系自訂」。已檢索 ${(g.searchedSources.length > 0 ? g.searchedSources : ["系網公告"]).join("、")}，` +
          `所得公告未載明適用之入學學年，無法確認是否適用本案。`,
      citations: [toCitation(g.citation, pack), ...(r?.citations ?? [])],
      impact: "畢業條件之一無法判定，未計入上方判定。",
      contact: g.contact,
    });
  }

  return holds;
}

function describeImpact(
  categoryId: string,
  main: AssignmentResult,
  alternative: AssignmentResult | null,
  pack: RulePack,
  credits: number,
  affects: RuleAmbiguity["affects"],
): string {
  if (affects === "undetermined") return `${credits} 學分之類別歸屬未定，未計入任何類別。`;
  if (!alternative) return `${credits} 學分未計入本次計算。`;

  const cat = pack.categories.find((c) => c.id === categoryId)!;
  const before = tallyOf(main, cat);
  const after = tallyOf(alternative, cat);
  if (before.unmet === after.unmet) {
    return `採計與否不改變${cat.name}之未修學分（均為 ${before.unmet}），但會使修得總學分增加 ${credits}。`;
  }
  return `採計後${cat.name}未修 ${before.unmet} → ${after.unmet}`;
}

function tallyOf(result: AssignmentResult, cat: RuleCategory): CategoryTally {
  const f = result.filled.get(cat.id) ?? { earned: 0, inProgress: 0 };
  return tally(cat.credits, f.earned, f.inProgress);
}

function buildGraduationChecks(input: AuditInput, pack: RulePack, holds: HoldItem[]): GraduationCheck[] {
  return officialChecks(input, pack, holds).map((c) => withDeclaration(c, input.declarations));
}

/**
 * 學生自行勾選。只用在學校資料看不出來（待確認）的條件上：
 * 學校紀錄說「未通過」的，自己勾不掉；說「通過」的，也不需要勾。
 * 勾了就算通過，但一律標成「自行勾選」—— 系統沒有查核，畢業審查時以學校紀錄為準。
 */
function withDeclaration(c: GraduationCheck, declarations: Declarations | undefined): GraduationCheck {
  if (c.status !== "hold") return c;
  const d = declarations?.[c.id];
  if (!d?.passed) return { ...c, declarable: true };
  return {
    ...c,
    status: "satisfied",
    label: "自行勾選",
    // 日期用台灣時間（UTC+8）：半夜勾的不能顯示成前一天
    detail: `你在 ${new Date(Date.parse(d.at) + 8 * 3600_000).toISOString().slice(0, 10)} 自行勾選已通過。系統沒有查核，畢業審查時以學校紀錄為準。`,
    declarable: true,
    selfDeclared: true,
  };
}

function officialChecks(input: AuditInput, pack: RulePack, holds: HoldItem[]): GraduationCheck[] {
  const evidence = input.record.graduationEvidence ?? {};
  return pack.graduationChecks.map((g) => {
    const citations = [toCitation(g.citation, pack)];
    if (g.rule === "deptDefined") {
      const r = input.deptDefinedResolutions?.[g.id];
      if (!r?.resolved) {
        return {
          id: g.id,
          name: g.name,
          status: "hold" as const,
          label: "待確認",
          detail: holds.find((h) => h.id === `hold-check-${g.id}`)?.body ?? "查無適用本學年度之明文。",
          citations,
        };
      }
      citations.push(...r.citations);
      return toEvidenceCheck(g.id, g.name, evidence[g.id], r.detail, citations);
    }
    if (g.rule === "passedCourse") return toCourseCheck(g, input.record.courses, citations);
    return toEvidenceCheck(g.id, g.name, evidence[g.id], undefined, citations);
  });
}

/**
 * 從成績單判斷：有修過指定課名的課（0 學分的國防、體育）。
 *
 * 只有「通過」與「待確認」兩種結果，不判「未修」：成績單上找不到，可能只是課名寫法
 * 跟規則包不同 —— 那是系統的錯，不能變成學生的「未修」。
 */
function toCourseCheck(
  g: RulePack["graduationChecks"][number],
  courses: CourseRecord[],
  citations: Citation[],
): GraduationCheck {
  const names = new Set((g.courseNames ?? []).map(normalizeName));
  const need = g.minTerms ?? 1;
  const termsOf = (status: CourseRecord["status"]) =>
    new Set(courses.filter((c) => c.status === status && names.has(normalizeName(c.name))).map((c) => `${c.year}-${c.term}`))
      .size;
  const passed = termsOf("passed");
  const inProgress = termsOf("in_progress");
  const terms = need > 1 ? `（${passed}/${need} 學期）` : "";
  if (passed >= need) {
    return { id: g.id, name: g.name, status: "satisfied", label: "通過", detail: `成績單上已修畢${terms}。`, citations };
  }
  const wanted = (g.courseNames ?? []).map((n) => `「${n}」`).join("或");
  return {
    id: g.id,
    name: g.name,
    status: "hold",
    label: passed + inProgress >= need ? "修課中" : "待確認",
    detail:
      passed + inProgress >= need
        ? `已修 ${passed} 學期，本學期修課中，修畢即達成。`
        : `成績單上找到的${wanted}${need > 1 ? `只有 ${passed} 學期，需要 ${need} 學期` : "還沒有通過的紀錄"}。` +
          `若成績單上的課名寫法不同，請洽「${g.contact}」確認。`,
    citations,
  };
}

function toEvidenceCheck(
  id: string,
  name: string,
  evidence: { status: "passed" | "waived" | "not_passed" | "unknown"; note?: string; label?: string } | undefined,
  prefix: string | undefined,
  citations: Citation[],
): GraduationCheck {
  const status = evidence?.status ?? "unknown";
  const map = {
    passed: { status: "satisfied" as const, label: "通過" },
    waived: { status: "satisfied" as const, label: "免測" },
    not_passed: { status: "unmet" as const, label: "未通過" },
    unknown: { status: "hold" as const, label: "待確認" },
  }[status];
  const detail = [prefix, evidence?.note ?? (status === "unknown" ? "修課紀錄未含本項佐證，無法判定。" : "")]
    .filter(Boolean)
    .join(" ");
  return { id, name, status: map.status, label: evidence?.label ?? map.label, detail, citations };
}

function buildVerdict(a: {
  pack: RulePack;
  categories: CategoryResult[];
  countable: number;
  inProgress: number;
  unmet: number;
  overflow: number;
  totalEarned: number;
  graduationChecks: GraduationCheck[];
  holds: HoldItem[];
}): Verdict {
  const unmetCats = a.categories.filter((c) => c.status === "unmet");
  const unmetChecks = a.graduationChecks.filter((c) => c.status === "unmet");
  const shortBy = unmetCats
    .filter((c) => c.unmet > 0)
    .map((c) => `${c.name} ${c.unmet}`)
    .join("、");

  const subOnly = unmetCats.filter((c) => c.unmet === 0);

  const parts: string[] = [];
  parts.push(`已修得 <b>${a.totalEarned} 學分</b>`);
  if (a.overflow > 0) {
    // 寫出是哪幾類超修：輔大的超修有其他選修、也有通識（全人教育課程超修不列入畢業學分）
    const from = a.categories.filter((c) => c.overflow > 0).map((c) => `${c.name} ${c.overflow}`).join("、");
    parts.push(`其中超修的 <b>${a.overflow} 學分</b>（${from}）依學則不得流用，可採計者為 ${a.countable} 學分`);
  }
  if (a.inProgress > 0) {
    parts.push(`加計本學期修課中的 ${a.inProgress} 學分後`);
  }
  if (a.unmet > 0) {
    parts.push(`仍須補修 <b>${a.unmet} 學分</b>（${shortBy}）`);
  } else {
    parts.push("學分數已達各類別應修學分");
  }
  if (subOnly.length > 0) {
    parts.push(
      `另有 ${subOnly.map((c) => `${c.name}${c.subRules.find((s) => s.status === "unmet")?.detail ?? ""}`).join("；")}`,
    );
  }
  if (unmetChecks.length > 0) {
    parts.push(`畢業條件尚未通過：${unmetChecks.map((c) => c.name).join("、")}`);
  }
  // 修課紀錄看不出來的畢業條件（沒有佐證）：不是未通過，也不能當成通過
  const holdChecks = a.graduationChecks.filter((c) => c.status === "hold");
  if (holdChecks.length > 0) {
    parts.push(`畢業條件待確認：${holdChecks.map((c) => c.name).join("、")}`);
  }
  const declared = a.graduationChecks.filter((c) => c.selfDeclared);
  if (declared.length > 0) {
    parts.push(`其中 ${declared.map((c) => c.name).join("、")} 是你自行勾選的，系統未查核`);
  }
  const detail = parts.join("，") + "。";

  const blocked = unmetCats.length > 0 || unmetChecks.length > 0;
  if (blocked) {
    // 「總學分已達門檻」指的是修得 + 修課中已足額，但分類未達 ——
    // 這正是超修不得流用造成的情況，標題必須把兩件事分開講。
    const headline =
      a.totalEarned + a.inProgress >= a.pack.minCredits
        ? "總學分已達門檻，但尚不符合畢業條件"
        : "尚未符合畢業條件";
    return { headline, detail, level: "unmet" };
  }
  if (a.inProgress > 0) {
    return {
      headline: "修課中科目成績登錄後即符合學分條件",
      detail,
      level: "ok",
    };
  }
  return {
    headline: a.holds.length > 0 || holdChecks.length > 0 ? "學分條件已符合，另有待確認事項" : "已符合畢業學分條件",
    detail,
    level: "ok",
  };
}
