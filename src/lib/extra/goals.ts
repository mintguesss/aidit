import type { AuditResult, Citation, CourseRecord, ExtraGoal, Student } from "@/lib/types";
import { resolveDept, type Dept } from "@/lib/offerings/depts";
import { findExtraPack, type ExtraPack } from "@/lib/rules/extra-packs";

/**
 * 額外修業目標（輔系／雙主修／學分學程／轉系）的現況整理。
 *
 * 界線一樣沒有變，只是「有沒有規定」現在會有兩種結果：
 *   **已收錄該項規定**　逐項算出應修／已修／修課中／未修，與主修一樣是確定性計算，
 *                       每一條都附得出 citation。
 *   **尚未收錄**　　　　只列出相關的已修課程（那是事實），並說明缺哪些資料才能判定；
 *                       絕不在沒有規則依據的情況下給出「還差幾學分」。
 *
 * 這兩種結果都不是模型產生的：前者來自 extra-packs 的規定，後者來自「查不到」。
 */

export type ExtraGoalCourse = {
  code: string;
  name: string;
  credits: number;
  year: number;
  term: CourseRecord["term"];
  status: CourseRecord["status"];
  /** 這門課目前計入本系的哪一個類別；未被採計時為 undefined */
  countedAs?: string;
};

/** 已收錄規定時，逐項的達成情形 */
export type ExtraRequirementResult = {
  id: string;
  label: string;
  required: number;
  earned: number;
  inProgress: number;
  unmet: number;
  /** 指定科目清單時，還缺哪幾個課號 */
  missingCodes: string[];
  /** 規定要幾門（「選修 3 門」）時：已採計幾門、還差幾門 */
  courses?: number;
  missingCourses?: number;
  citation: Citation;
};

export type ExtraGoalSummary = {
  goal: ExtraGoal;
  kindLabel: string;
  /** 來自校務系統的註冊事實（true），或學生自行宣告的打算（false） */
  registered: boolean;
  /** 解析到的系所；學分學程或查無對照時為 undefined */
  dept?: Dept;
  /** 該項規定是否已收錄（收錄了才算得出還差哪些） */
  rulesLoaded: boolean;
  /** 可以據實呈現的相關修課 */
  courses: ExtraGoalCourse[];
  credits: number;
  /** 已收錄規定時的判定結果 */
  audit?: {
    packId: string;
    title: string;
    version: string;
    provenance: string;
    docId: string;
    minCredits: number;
    earned: number;
    inProgress: number;
    unmet: number;
    requirements: ExtraRequirementResult[];
    overlapPolicy: string;
    overlapCitation: Citation;
    /** 跟規定科目同名、但不是該系開的課：可申請免修，由雙主修學系主任認定。不計入上面的數字 */
    waiverCandidates?: { code: string; name: string; credits: number }[];
    /** 「至少一半不能是主系必修」：還要再修幾學分非主系必修的學程課 */
    nonMainShortfall?: number;
  };
  /** 尚未收錄時：為什麼算不出「還差哪些」，以及需要補齊什麼 */
  blocked?: string;
  needs: string[];
};

export const KIND_LABEL: Record<ExtraGoal["kind"], string> = {
  minor: "輔系",
  "double-major": "雙主修",
  "cert-program": "學分學程",
  transfer: "轉系",
};

const NEEDS: Record<ExtraGoal["kind"], string[]> = {
  minor: ["該系輔系應修科目與最低學分", "本系課程可否抵充輔系學分之認定", "申請與核可程序"],
  "double-major": [
    "該系之完整課程規劃表（雙主修須同時滿足兩系畢業條件）",
    "兩系共同科目之重複採計規定",
    "修業年限與學分上限之放寬規定",
  ],
  "cert-program": ["該學程之應修科目清單與最低學分", "已修科目可否採計入學程", "學程證明之申請程序"],
  transfer: ["轉入學系之課程規劃表", "轉系錄取後之學分採計辦法", "轉系申請資格與時程"],
};

/**
 * 學籍資料裡已註冊的輔系／雙主修／學分學程。
 *
 * 這是校務系統說的事實，系統本來就知道，不必等學生再宣告一次 ——
 * 反過來說，**沒有這些欄位的一般生就不該出現額外修業目標**。
 * 學生自己在個人資料頁填的，是「還沒註冊但打算修」的那一種。
 */
export function registeredGoals(student: Student | undefined): ExtraGoal[] {
  if (!student) return [];
  const out: ExtraGoal[] = [];
  for (const d of student.minors ?? []) out.push({ kind: "minor", target: d });
  for (const d of student.doubleMajors ?? []) out.push({ kind: "double-major", target: d });
  for (const p of student.certPrograms ?? []) out.push({ kind: "cert-program", target: p });
  return out;
}

export function summariseExtraGoals(
  goals: ExtraGoal[],
  courses: CourseRecord[],
  audit: AuditResult,
  registered: ExtraGoal[] = [],
): ExtraGoalSummary[] {
  // 已註冊的排前面；學生自行宣告的若與已註冊重複就不再列一次
  const key = (g: ExtraGoal) => `${g.kind}:${g.target}`;
  const seen = new Set(registered.map(key));
  const all = [...registered, ...goals.filter((g) => !seen.has(key(g)))];
  const isRegistered = (g: ExtraGoal) => seen.has(key(g));
  // 課號 → 目前計入本系的哪一類別
  const countedAs = new Map<string, string>();
  for (const cat of audit.categories) {
    for (const code of cat.assignedCodes) countedAs.set(code, cat.shortName ?? cat.name);
  }

  return all.slice(0, 4).map<ExtraGoalSummary>((goal) => {
    const kindLabel = KIND_LABEL[goal.kind];
    const dept = goal.kind === "cert-program" ? undefined : resolveDept(goal.target);

    // 轉系不是「加修另一套規定」，它會換掉適用的主修規劃表，不在這裡判定
    const pack =
      goal.kind === "transfer"
        ? undefined
        : findExtraPack(goal.kind, {
            dept: dept?.code,
            program: goal.target,
            school: audit.student.school ?? "demo",
            startYear: Number(audit.nextTerm.split("-")[0]),
          });

    const usable = courses.filter((c) => c.status !== "failed" && c.status !== "withdrawn");

    // 相關修課：有規定就照規定的科目範圍取，沒有就退回「該系開設的課」
    const inScope = pack
      ? usable.filter((c) => matchesAny(pack, c))
      : dept === undefined
        ? []
        : usable.filter((c) => c.offeringDept === dept.code);

    const matched = inScope
      .slice()
      .sort((a, b) => a.year - b.year || termRank(a.term) - termRank(b.term))
      .map<ExtraGoalCourse>((c) => ({
        code: c.code,
        name: c.name,
        credits: c.credits,
        year: c.year,
        term: c.term,
        status: c.status,
        countedAs: countedAs.get(c.equivalentOf ?? c.code) ?? countedAs.get(c.code),
      }));

    const base = {
      goal,
      kindLabel,
      registered: isRegistered(goal),
      dept,
      courses: matched,
      credits: matched.reduce((a, c) => a + c.credits, 0),
      needs: NEEDS[goal.kind],
    };

    if (pack) {
      return { ...base, rulesLoaded: true, audit: auditExtra(pack, usable, mainRequiredOf(audit)) };
    }

    const blocked =
      goal.kind === "transfer"
        ? `轉系會換掉適用的課程規劃表，已修學分能採計多少、採計到哪一類，由轉入學系逐案認定，不是規則包能推導出來的。`
        : goal.kind === "cert-program"
          ? `尚未收錄「${goal.target}」學程的修習要點，因此連「哪幾門屬於這個學程」都對不出來，更無從計算還差哪些。`
          : dept === undefined
            ? `系所對照表中查無「${goal.target}」，無法辨識哪些修課與它相關。`
            : `尚未收錄「${dept.name}」的${kindLabel}規定，因此系統不計算還差哪些 —— 沒有規則依據的學分數字，看起來跟真的一樣，但它是猜的。`;

    return { ...base, rulesLoaded: false, blocked };
  });
}

/** 本系的必修類別（名稱有「必修」的類別）採計了哪些課 */
export function mainRequiredOf(audit: AuditResult): (code: string) => boolean {
  const codes = new Set(audit.categories.filter((c) => /必修/.test(c.name)).flatMap((c) => c.assignedCodes));
  return (code) => codes.has(code);
}

/** 某一門課是否落在這份規定的任一項目範圍內 */
function matchesAny(pack: ExtraPack, c: CourseRecord): boolean {
  return pack.requirements.some((r) => hits(pack, r, c));
}

/** 課名比對：大小寫、全半形、空白、「-英」「-網」尾碼都不算差別；「普通心理學(一)」算「普通心理學」 */
const normName = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s/g, "").replace(/-(英|網)+$/g, "");
function nameMatches(names: string[], courseName: string): boolean {
  const n = normName(courseName);
  return names.some((x) => {
    const want = normName(x);
    return n === want || n.startsWith(`${want}(`);
  });
}

/** 某一門課是否落在某一項的範圍內 */
function hits(pack: ExtraPack, r: ExtraPack["requirements"][number], c: CourseRecord): boolean {
  const code = c.equivalentOf ?? c.code;
  switch (r.match.type) {
    case "courseList":
      return r.match.codes.includes(code);
    case "deptElective":
      return c.offeringDept === r.match.dept;
    case "courseNames":
      return nameMatches(r.match.names, c.name) && (!r.deptOnly || c.offeringDept === pack.dept);
  }
}

/**
 * 逐項判定：與主修引擎同一套想法 —— 指定科目清單只認清單上的課，
 * 系選修只認該系開設的課，且**不得重複採計**（一門課只能滿足一個項目，
 * 指定科目優先）。超出應修學分的部分不流用到別的項目。
 */
export function auditExtra(
  pack: ExtraPack,
  courses: CourseRecord[],
  /** 這門課在本系是不是算必修（學程「至少一半不得為主系必修」要用） */
  mainRequired: (code: string) => boolean = () => false,
): NonNullable<ExtraGoalSummary["audit"]> {
  const used = new Set<string>();
  const counted: CourseRecord[] = [];
  const requirements: ExtraRequirementResult[] = [];

  // 指定科目清單先分配，剩下的才給系選修 —— 反過來會讓必修課被選修吃掉
  const ordered = [...pack.requirements].sort(
    (a, b) => rank(a.match.type) - rank(b.match.type),
  );

  for (const r of ordered) {
    let earned = 0;
    let inProgress = 0;
    let count = 0;
    const hitCodes = new Set<string>();

    for (const c of courses) {
      const code = c.equivalentOf ?? c.code;
      if (used.has(`${code}-${c.year}-${c.term}`)) continue;
      if (!hits(pack, r, c)) continue;

      // 超過該項目應修學分（或門數）之後就不再吃課，留給其他項目
      const full = r.minCourses ? count >= r.minCourses && earned + inProgress >= r.credits : earned + inProgress >= r.credits;
      if (full) continue;
      used.add(`${code}-${c.year}-${c.term}`);
      counted.push(c);
      // 學年課上下兩半是同一門課，門數只算一次
      if (!hitCodes.has(code)) count += 1;
      hitCodes.add(code);
      if (c.status === "in_progress") inProgress += c.credits;
      else earned += c.credits;
    }

    const got = Math.min(r.credits, earned + inProgress);
    // 規定的是門數時，門數夠了就算滿足（「核心選修 3 門」修了三門 2 學分的課也算）
    const coursesOk = r.minCourses !== undefined && count >= r.minCourses;
    requirements.push({
      id: r.id,
      label: r.label,
      required: r.credits,
      earned: Math.min(r.credits, earned),
      inProgress: Math.max(0, got - Math.min(r.credits, earned)),
      unmet: coursesOk ? 0 : Math.max(0, r.credits - got),
      missingCodes:
        r.match.type === "courseList" ? r.match.codes.filter((x) => !hitCodes.has(x)) : [],
      ...(r.minCourses !== undefined ? { courses: count, missingCourses: Math.max(0, r.minCourses - count) } : {}),
      citation: {
        docId: r.citation.docId,
        docTitle: pack.document.title,
        locator: r.citation.locator,
        quote: r.citation.quote,
        publishedAt: pack.document.publishedAt,
      },
    });
  }

  // 回到規定書上的順序呈現
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const rows = pack.requirements.map((r) => byId.get(r.id)!).filter(Boolean);

  // 跟規定科目同名、但不是該系開的課（主系的「統計學」「微積分」）：可申請免修，由雙主修學系主任認定。
  // 只列出來，不算進去 —— 認不認定不是規則推得出來的
  const requiredNames = pack.requirements.flatMap((r) =>
    r.match.type === "courseNames" ? r.match.names : r.match.type === "courseList" ? Object.values(r.names ?? {}) : [],
  );
  const usedKey = (c: CourseRecord) => `${c.equivalentOf ?? c.code}-${c.year}-${c.term}`;
  const waiverCandidates = pack.waiverByName
    ? [
        ...new Map(
          courses
            .filter((c) => c.status === "passed" && !used.has(usedKey(c)) && nameMatches(requiredNames.map((n) => n.replace(/\(.*\)$/, "")), c.name))
            .map((c) => [c.equivalentOf ?? c.code, { code: c.equivalentOf ?? c.code, name: c.name, credits: c.credits }]),
        ).values(),
      ]
    : undefined;

  // 至少一半不得為主系必修：只看已經採計的課；主系必修的部分超過一半，就還要再修非主系必修的學程課
  let nonMainShortfall: number | undefined;
  if (pack.nonMainRequiredShare) {
    const nonMain = counted.filter((c) => !mainRequired(c.equivalentOf ?? c.code)).reduce((a, c) => a + c.credits, 0);
    nonMainShortfall = Math.max(0, Math.ceil(pack.minCredits * pack.nonMainRequiredShare.min) - nonMain);
  }

  return {
    ...(waiverCandidates?.length ? { waiverCandidates } : {}),
    ...(nonMainShortfall !== undefined ? { nonMainShortfall } : {}),
    packId: pack.id,
    title: pack.title,
    version: pack.version,
    provenance: pack.provenance,
    docId: pack.document.id,
    minCredits: pack.minCredits,
    earned: rows.reduce((a, r) => a + r.earned, 0),
    inProgress: rows.reduce((a, r) => a + r.inProgress, 0),
    unmet: rows.reduce((a, r) => a + r.unmet, 0),
    requirements: rows,
    overlapPolicy: pack.overlapPolicy,
    overlapCitation: {
      docId: pack.overlapCitation.docId,
      docTitle: pack.document.title,
      locator: pack.overlapCitation.locator,
      quote: pack.overlapCitation.quote,
      publishedAt: pack.document.publishedAt,
    },
  };
}

const rank = (t: string) => (t === "courseList" ? 0 : 1);

function termRank(t: CourseRecord["term"]): number {
  return t === 1 ? 1 : t === 2 ? 2 : 3;
}
