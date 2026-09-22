import type { CourseRecord, StudentRecord, Student } from "@/lib/types";
import type { CategoryExpectation } from "./cases";

/**
 * 程式生成的 golden 案例（SPEC.md §10 要求 30–50 份）。
 *
 * 標準答案由本檔的**獨立參考實作** `reference()` 計算，而不是呼叫 audit engine ——
 * 否則回歸測試只會證明引擎與自己一致。
 *
 * 為了讓獨立參考實作能保持「一眼可複核」的簡單度，生成器刻意把每個案例
 * 限制在「指派無歧義」的範圍內：
 *   - 通識學分永遠 ≤ 12，系專業選修學分永遠 ≤ 24（不會溢出到自由選修）
 *   - 他系選修只符合自由選修一個類別
 * 真正有歧義的難例（超修流用、跨院、抵免、重補修）由 cases.ts 的人工答案負責。
 */

const REQUIRED_TOTAL = { common: 20, college: 12, major: 48 } as const;

const COMMON: [string, string, number][] = [
  ["GC1001", "國文（一）", 2],
  ["GC1002", "國文（二）", 2],
  ["GC1101", "英文（一）", 2],
  ["GC1102", "英文（二）", 2],
  ["GC1201", "公民素養", 3],
  ["GC1301", "體育（一）", 1],
  ["GC1302", "體育（二）", 1],
  ["GC1401", "服務學習", 1],
  ["GC1501", "資訊素養與倫理", 3],
  ["GC1601", "邏輯與批判思考", 3],
];

const COLLEGE: [string, string, number][] = [
  ["BM2001", "管理學", 3],
  ["BM2002", "經濟學", 3],
  ["BM2003", "會計學", 3],
  ["BM2004", "統計學", 3],
];

/** 系專業必修，依規劃表順序；生成器會從尾端截斷以製造未修 */
const MAJOR: [string, string, number][] = [
  ["IM2001", "程式設計（一）", 3],
  ["IM2002", "程式設計（二）", 3],
  ["IM2003", "資料結構", 3],
  ["IM2004", "資料庫管理", 3],
  ["IM2005", "系統分析與設計", 3],
  ["IM3001", "計算機網路", 3],
  ["IM3002", "作業系統概論", 3],
  ["IM3003", "管理資訊系統", 3],
  ["IM3004", "演算法", 3],
  ["IM3005", "軟體工程", 3],
  ["IM3006", "資訊安全概論", 3],
  ["IM3007", "電子商務", 3],
  ["IM3008", "專案管理", 3],
  ["IM4003", "企業資源規劃", 2],
  ["IM4001", "專題研究（一）", 3],
  ["IM4002", "專題研究（二）", 4],
];

const DOMAINS = ["人文藝術", "社會科學", "自然科技", "生命探索"] as const;

const IM_ELECTIVES: [string, string][] = [
  ["IM4011", "巨量資料分析"],
  ["IM4012", "使用者介面設計"],
  ["IM4013", "雲端運算服務"],
  ["IM4014", "數位行銷分析"],
  ["IM4015", "供應鏈資訊系統"],
  ["IM4016", "決策支援系統"],
  ["IM4017", "資訊系統稽核"],
  ["IM4018", "區塊鏈應用"],
];

const OTHER_ELECTIVES: [string, string, string][] = [
  ["FN3001", "投資學", "FN"],
  ["FN3002", "財務管理", "FN"],
  ["FN3003", "金融科技導論", "FN"],
  ["BA3001", "組織行為", "BA"],
  ["BA3002", "人力資源管理", "BA"],
  ["BA3003", "創新與創業", "BA"],
  ["FN3004", "國際金融", "FN"],
];

export type GenParams = {
  /** 通識及格學分（2 的倍數，≤ 12） */
  generalPassed: number;
  /** 通識修課中學分（2 的倍數） */
  generalInProgress: number;
  /** 涵蓋的通識領域數（1–4） */
  domainsCovered: number;
  /** 系專業選修及格學分（3 的倍數，≤ 24） */
  imElective: number;
  /** 他系選修及格學分（3 的倍數） */
  otherElective: number;
  /** 系專業必修從尾端少修的門數 */
  majorMissing: number;
  /** 系專業必修最後一門是否為修課中 */
  majorLastInProgress: boolean;
};

export type GeneratedCase = {
  id: string;
  tests: string;
  record: StudentRecord;
  expect: {
    totalEarned: number;
    countable: number;
    inProgress: number;
    unmet: number;
    overflow: number;
    categories: CategoryExpectation[];
  };
};

/** 參數格：刻意涵蓋「剛好滿足」「差一點」「超修」「領域未達」四種形狀 */
const GRID: GenParams[] = [
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 10, generalInProgress: 2, domainsCovered: 4, imElective: 24, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 8, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 6, generalInProgress: 4, domainsCovered: 3, imElective: 24, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 3, imElective: 24, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 21, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 18, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 12, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 21, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 18, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 9, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 0, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 12, majorMissing: 1, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 12, majorMissing: 2, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 12, majorMissing: 3, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 12, majorMissing: 0, majorLastInProgress: true },
  { generalPassed: 10, generalInProgress: 2, domainsCovered: 4, imElective: 21, otherElective: 12, majorMissing: 0, majorLastInProgress: true },
  { generalPassed: 8, generalInProgress: 2, domainsCovered: 3, imElective: 18, otherElective: 15, majorMissing: 1, majorLastInProgress: false },
  { generalPassed: 6, generalInProgress: 0, domainsCovered: 2, imElective: 15, otherElective: 18, majorMissing: 2, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 1, imElective: 24, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 4, generalInProgress: 0, domainsCovered: 2, imElective: 24, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 0, domainsCovered: 4, imElective: 24, otherElective: 15, majorMissing: 1, majorLastInProgress: true },
  { generalPassed: 10, generalInProgress: 0, domainsCovered: 4, imElective: 12, otherElective: 21, majorMissing: 3, majorLastInProgress: false },
  { generalPassed: 12, generalInProgress: 2, domainsCovered: 4, imElective: 24, otherElective: 12, majorMissing: 0, majorLastInProgress: false },
];

export function generatedCases(): GeneratedCase[] {
  return GRID.map((p, i) => build(`gen-${String(i + 1).padStart(2, "0")}`, p));
}

function build(id: string, p: GenParams): GeneratedCase {
  const courses: CourseRecord[] = [];
  const push = (
    code: string,
    name: string,
    credits: number,
    selectType: CourseRecord["selectType"],
    status: CourseRecord["status"],
    extra: Partial<CourseRecord> = {},
  ) => {
    courses.push({
      code,
      name,
      credits,
      year: 112,
      term: 1,
      selectType,
      status,
      score: status === "passed" ? 80 : null,
      ...extra,
    });
  };

  for (const [c, n, cr] of COMMON) push(c, n, cr, "required", "passed");
  for (const [c, n, cr] of COLLEGE) push(c, n, cr, "required", "passed", { offeringDept: "BA", offeringCollege: "MGT" });

  const majorKept = MAJOR.slice(0, MAJOR.length - p.majorMissing);
  majorKept.forEach(([c, n, cr], idx) => {
    const last = idx === majorKept.length - 1;
    push(c, n, cr, "required", last && p.majorLastInProgress ? "in_progress" : "passed", {
      offeringDept: "IM",
      offeringCollege: "MGT",
    });
  });

  // 通識：每門 2 學分，領域依序輪替，確保 domainsCovered 個領域被涵蓋
  const genPassedCount = p.generalPassed / 2;
  for (let i = 0; i < genPassedCount; i++) {
    push(`GE1${String(100 + i).padStart(3, "0")}`, `通識科目 ${i + 1}`, 2, "general", "passed", {
      generalDomain: DOMAINS[Math.min(i, p.domainsCovered - 1)],
    });
  }
  const genDoingCount = p.generalInProgress / 2;
  for (let i = 0; i < genDoingCount; i++) {
    push(`GE2${String(100 + i).padStart(3, "0")}`, `通識科目（修課中）${i + 1}`, 2, "general", "in_progress", {
      generalDomain: DOMAINS[Math.min(i, p.domainsCovered - 1)],
    });
  }

  const imCount = p.imElective / 3;
  for (let i = 0; i < imCount; i++) {
    const [c, n] = IM_ELECTIVES[i]!;
    push(c, n, 3, "elective", "passed", { offeringDept: "IM", offeringCollege: "MGT" });
  }

  const otherCount = p.otherElective / 3;
  for (let i = 0; i < otherCount; i++) {
    const [c, n, d] = OTHER_ELECTIVES[i]!;
    push(c, n, 3, "elective", "passed", { offeringDept: d, offeringCollege: "MGT" });
  }

  const student: Student = {
    id: `S-${id.toUpperCase()}`,
    dept: "IM",
    admissionYear: 111,
    actualAdmissionYear: 111,
    status: "enrolled",
    program: "day",
    maskedId: "4111·····",
    displayName: "測試○○",
    className: "資管四甲（日間部）",
  };

  const record: StudentRecord = {
    student,
    courses,
    fetchedAt: "2026-09-13T13:48:00.000Z",
    source: "mock",
    graduationEvidence: {
      chinese: { status: "waived", label: "免測" },
      computing: { status: "passed", label: "通過" },
      service: { status: "passed", label: "已完成" },
    },
  };

  return { id, tests: describe(p), record, expect: reference(p) };
}

function describe(p: GenParams): string {
  const bits: string[] = [];
  bits.push(`通識 ${p.generalPassed}+${p.generalInProgress}／${p.domainsCovered} 領域`);
  bits.push(`系專選 ${p.imElective}`);
  bits.push(`他系 ${p.otherElective}`);
  if (p.majorMissing > 0) bits.push(`系專必修少 ${p.majorMissing} 門`);
  if (p.majorLastInProgress) bits.push("末門修課中");
  return bits.join("、");
}

/**
 * 獨立參考實作。
 *
 * 刻意只用四則運算，不引用 audit engine 的任何程式碼；
 * 生成器保證每個案例的指派無歧義，因此下面這幾行就是正確答案。
 */
function reference(p: GenParams): GeneratedCase["expect"] {
  const majorKept = MAJOR.slice(0, MAJOR.length - p.majorMissing);
  const majorCredits = majorKept.reduce((a, [, , cr]) => a + cr, 0);
  const majorLast = majorKept[majorKept.length - 1]?.[2] ?? 0;
  const majorInProgress = p.majorLastInProgress ? majorLast : 0;
  const majorEarnedRaw = majorCredits - majorInProgress;

  const common = tally(REQUIRED_TOTAL.common, REQUIRED_TOTAL.common, 0);
  const college = tally(REQUIRED_TOTAL.college, REQUIRED_TOTAL.college, 0);
  const major = tally(REQUIRED_TOTAL.major, majorEarnedRaw, majorInProgress);
  const general = tally(12, p.generalPassed, p.generalInProgress);
  const imElective = tally(24, p.imElective, 0);
  const free = tally(12, p.otherElective, 0);

  // 生成器以 min(i, domainsCovered-1) 指定領域，實際涵蓋數不會超過通識及格門數
  const actuallyCovered = Math.min(p.domainsCovered, p.generalPassed / 2);
  const domainUnmet = actuallyCovered < 4;

  const categories: CategoryExpectation[] = [
    { id: "common-required", ...common, status: statusOf(common, false) },
    { id: "general", ...general, status: statusOf(general, domainUnmet) },
    { id: "college-core", ...college, status: statusOf(college, false) },
    { id: "major-required", ...major, status: statusOf(major, false) },
    { id: "major-elective", ...imElective, status: statusOf(imElective, false) },
    { id: "free-elective", ...free, status: statusOf(free, false) },
  ];

  const countable = categories.reduce((a, c) => a + c.earned, 0);
  const inProgress = categories.reduce((a, c) => a + c.inProgress, 0);
  const unmet = categories.reduce((a, c) => a + c.unmet, 0);
  const overflow = categories.reduce((a, c) => a + c.overflow, 0);

  return { totalEarned: countable + overflow, countable, inProgress, unmet, overflow, categories };
}

function tally(required: number, rawEarned: number, rawInProgress: number) {
  const earned = Math.min(rawEarned, required);
  const overflow = rawEarned - earned;
  const inProgress = Math.min(rawInProgress, required - earned);
  return { earned, inProgress, unmet: required - earned - inProgress, overflow };
}

function statusOf(
  t: { earned: number; inProgress: number; unmet: number },
  subRuleUnmet: boolean,
): CategoryExpectation["status"] {
  if (t.unmet > 0 || subRuleUnmet) return "unmet";
  if (t.inProgress > 0) return "pending_in_progress";
  return "satisfied";
}
