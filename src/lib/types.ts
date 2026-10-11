/**
 * Aidit 核心型別。docs/SPEC.md §3 的型別在此為唯一定義來源，
 * 其他模組一律 import，不得各自重宣告。
 */

// ---------------------------------------------------------------- 學籍與修課

export type Term = 1 | 2 | "summer";

export type Student = {
  /** 去識別後的代號，非學號 */
  id: string;
  /** 學校代號（lib/schools.ts）。未填為 "demo"，即合成資料 */
  school?: string;
  dept: string;
  /**
   * 組別。同系不同組的畢業規定不同（輔大物理系的物理組、光電物理組必修學分不一樣），
   * 規則包要同系、同組才對得上。沒分組的系不填
   */
  group?: string;
  /** 學籍入學學年 —— 畢業條件綁定此欄 */
  admissionYear: number;
  /** 實際入學學年（轉系／轉學時與上者不同） */
  actualAdmissionYear: number;
  status: "enrolled" | "leave" | "graduated";
  program: "day" | "night";
  minors?: string[];
  doubleMajors?: string[];
  certPrograms?: string[];
  /** 本系的甲／乙班（輔大必修分甲乙班上課）。不知道就不填，排課會讓整份課表在同一班 */
  classSection?: "甲" | "乙";
  /** 顯示用遮蔽字串，如 "4114·····"。不得為真實學號 */
  maskedId?: string;
  displayName?: string;
  className?: string;
};

export type CourseStatus = "passed" | "failed" | "in_progress" | "withdrawn" | "waived";
export type SelectType = "required" | "elective" | "general";

export type CourseRecord = {
  code: string;
  name: string;
  credits: number;
  year: number;
  term: Term;
  selectType: SelectType;
  generalDomain?: string;
  score: number | null;
  status: CourseStatus;
  waiverSource?: string;
  /** 開課單位；跨院採計的 ambiguity trigger 需要 */
  offeringDept?: string;
  offeringCollege?: string;
  /** 舊課號對照：本筆實際等同於哪一個現行課號 */
  equivalentOf?: string;
  /**
   * 學校的課程資料把這門課標為「學年課」：上下學期共用課號，兩筆是同一門課的上下兩半，
   * 不是重修。輔大的國文、外國語文就是這樣（各級別課號不同，規則包列不完）。
   * 引擎去重時與規則包的 yearLongCourses 一起看。
   */
  yearLong?: boolean;
};

/**
 * 轉系後的學分採計認定結果。
 *
 * 轉系生的兩個入學學年本來就不一致，依規劃表必須送系課程委員會個案認定。
 * 認定完成之後，「哪一門課採計為什麼」已經是**人決定過的事實**，不是系統要推論的東西 ——
 * 因此有這份認定結果時，系統就能依轉入學系的規劃表正常判定，
 * 並在畫面上標明判定是建立在哪一份認定上。沒有這份結果之前，仍然全案轉人工。
 */
export type TransferApproval = {
  fromDept: string;
  toDept: string;
  /** 核定日期（ISO 日期字串） */
  approvedAt: string;
  /** 核定單位 */
  approvedBy: string;
  /** 認定文件編號，供承辦人回查 */
  documentNo: string;
  /** 經認定可採計之科目；countAs 為轉入學系之類別 id */
  accepted: { code: string; countAs: string }[];
};

export type StudentRecord = {
  student: Student;
  courses: CourseRecord[];
  /** 轉系生的學分採計認定結果；未完成認定時為 undefined */
  transferApproval?: TransferApproval;
  /** ISO 時間字串 */
  fetchedAt: string;
  source: ProviderKind;
  /** 畢業條件檢核的外部佐證（語言檢定、服務學習等） */
  graduationEvidence?: Record<string, GraduationEvidence>;
  /**
   * 下學期已登記、不可衝突的時段（如校外實習、已預排之必修）。
   * 求解器據此排除衝堂課程；沒有這欄就無從說明「哪兩個條件在打架」。
   */
  plannedCommitments?: { label: string; slotText: string }[];
  /** 學生於基本資料填寫的選課傾向，第一版課表即依此產生 */
  preferences?: CoursePreferences;
};

export type GraduationEvidence = {
  status: "passed" | "waived" | "not_passed" | "unknown";
  note?: string;
  /** 覆寫 UI 顯示字樣，如服務學習顯示「已完成」而非「通過」 */
  label?: string;
};

export type ProviderKind = "mock" | "upload" | "session" | "api";

// ---------------------------------------------------------------- 開課

export type TimeSlot = {
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  periods: number[];
  /** 只在單週或雙週上課（輔大代號 S／D）。沒填就是每週。單週與雙週的課不衝堂 */
  weeks?: "odd" | "even";
};

export type PrerequisiteConfidence = "explicit" | "extracted" | "unknown";

export type Prerequisite = {
  codes: string[];
  confidence: PrerequisiteConfidence;
  sourceText?: string;
};

export type Offering = {
  /** 學校代號（lib/schools.ts）。排課只取同一所學校的課 */
  school: string;
  code: string;
  name: string;
  credits: number;
  year: number;
  term: Term;
  teacher: string;
  slots: TimeSlot[];
  /** 時段字串無法解析時為 true：仍可採計，但不參與衝堂判定 */
  slotsUnknown?: boolean;
  rawSlotText?: string;
  dept: string;
  college: string;
  /** 可採計之類別 id */
  category: string[];
  generalDomain?: string;
  /** 本系必修規劃給哪個年級。排課不會把高年級的必修排給低年級 */
  forGrade?: number;
  /** 選別。有填就依學生的規則包判斷可採計類別（見 lib/offerings 的 categoriesFor） */
  selectType?: SelectType;
  /** 學校大綱系統的編號（輔大：jonCouSn＋教師編號）。課綱頁打開時才去抓大綱（lib/offerings/outline.ts） */
  outline?: { id: number; tchNo: string };
  /** 開課班級（輔大 avaDptCNa），如「資管二甲」「CT-管理學院」「資管系專倫」。見 lib/offerings/class-group.ts */
  classGroup?: string;
  /** 不對外系開放（外系名額 0）。一般排課不用；雙主修、輔系試算列「下學期有開的」時會用到 */
  closedToOthers?: boolean;
  /** 上課教室 */
  rooms?: string[];
  /** 授課語言，如「中文」「全英文」 */
  language?: string;
  /** 課程標籤，如「全英-專業學科類」 */
  tags?: string[];
  prerequisites: Prerequisite[];
  /**
   * 修課人數上限與已選人數。**可能未知**：系上課表沒有這兩個數字，只有教務處系統有。
   * 未知時不是 0 —— 不能當成額滿排除，也不能編一個餘額出來。見 remainingSeats()。
   */
  capacity?: number;
  enrolled?: number;
  syllabusUrl?: string;
};

// ---------------------------------------------------------------- 依據

export type Citation = {
  docId: string;
  docTitle: string;
  /** 如 "第 4 頁附註 3" */
  locator: string;
  /** 原文片段，citation.verify 的唯一依據 */
  quote?: string;
  url?: string;
  publishedAt?: string;
};

export type CitationVerdict = {
  citation: Citation;
  ok: boolean;
  method?: "exact" | "fuzzy";
  ratio?: number;
  /** number_mismatch：模糊比對夠像，但數字跟原文不同 —— 規則裡最關鍵的就是數字 */
  reason?: "document_missing" | "quote_missing" | "quote_not_found" | "number_mismatch";
};

// ---------------------------------------------------------------- 審查結果

export type SubRuleResult = {
  id: string;
  name: string;
  status: "satisfied" | "unmet" | "pending_in_progress";
  detail: string;
  /** 通識領域分布這類逐項結果 */
  items?: {
    label: string;
    ok: boolean;
    note?: string;
    /** 以學分判定時還差幾學分（排課要補的量） */
    shortBy?: number;
    /** 要由哪個系所開的課來補（minDeptCredits）；沒有就是通識領域 */
    dept?: string;
  }[];
  citations: Citation[];
};

export type CategoryResult = {
  id: string;
  name: string;
  shortName: string;
  required: number;
  /** 已修得且可採計（不含超修） */
  earned: number;
  inProgress: number;
  unmet: number;
  /** 超修，不可流用 */
  overflow: number;
  status: "satisfied" | "unmet" | "pending_in_progress";
  subRules: SubRuleResult[];
  citations: Citation[];
  notes: string[];
  /** 被指派到此類別的課號，供依據展開與稽核 */
  assignedCodes: string[];
  /** 承接類別（任何及格的課都收，如其他選修）。排課時最後才補 */
  catchAll?: boolean;
};

export type GraduationCheck = {
  id: string;
  name: string;
  status: "satisfied" | "unmet" | "hold";
  /** UI 右側顯示字樣，如「免測」「通過」「待確認」 */
  label: string;
  detail: string;
  citations: Citation[];
  /**
   * 學校資料看不出來（待確認）的條件，學生可以自己勾「已通過」。
   * true 表示這一項開放自行勾選（不論目前有沒有勾）
   */
  declarable?: boolean;
  /** 目前的「通過」來自學生自行勾選，系統未查核 */
  selfDeclared?: boolean;
};

/** 學生對畢業條件的自行勾選。只用在學校資料看不出來的條件上 */
export type Declarations = Record<string, { passed: true; at: string }>;

export type HoldItem = {
  id: string;
  title: string;
  /** 已檢索過哪些來源、為何仍無法判定 */
  body: string;
  conflictOf?: [Citation, Citation];
  citations: Citation[];
  /** "採計後系專業選修未修 3 → 0" */
  impact: string;
  contact: string;
  affectedCategory?: string;
  /**
   * body 的結構化拆解，給介面分開呈現（原因一句、涉及科目、已查過的來源）。
   * body 仍是完整文字，複製與詢問信用它。
   */
  reason?: string;
  courses?: { code: string; name: string; credits: number }[];
  searched?: string[];
};

export type Verdict = {
  headline: string;
  detail: string;
  level: "ok" | "unmet" | "blocked";
};

export type AuditResult = {
  traceId: string;
  rulePack: { id: string; version: string; approvedAt: string; provenance: RulePackProvenance };
  student: Student;
  fetchedAt: string;
  minCredits: number;
  /** 含超修 */
  totalEarned: number;
  countable: number;
  inProgress: number;
  unmet: number;
  overflow: number;
  categories: CategoryResult[];
  graduationChecks: GraduationCheck[];
  holds: HoldItem[];
  verdict: Verdict;
  /** 下一個學期代號，如 "115-1" */
  nextTerm: string;
  /** 本次判定所依據的原始學期，如 "114-2" */
  currentTerm: string;
};

export type RulePackProvenance = "approved" | "draft" | "synthetic";

// ---------------------------------------------------------------- 求解

export type Preset = "fill-unmet" | "no-early" | "fewest-courses";

/**
 * 選課傾向：學生在基本資料階段填寫，作為第一版課表的依據。
 *
 * 這是「先有傾向、再談微調」的起點 —— 沒有傾向就只能給一份誰都不合用的最佳解，
 * 使用者得從零開始靠對話把它調成自己要的樣子。
 */
/**
 * 額外修業目標。
 *
 * 輔系、雙主修、學分學程、轉系是四件不同的事，適用的規定也不同。
 * 學生宣告之後，系統會在首頁、修業明細與選課建議據實呈現「已修的相關課程」，
 * 但**不會**在沒有該項規定的情況下計算「還差哪些」。
 */
export type ExtraGoal = {
  kind: "minor" | "double-major" | "cert-program" | "transfer";
  /** 系所或學程名稱 */
  target: string;
};

export type CoursePreferences = {
  /**
   * asap     —— 以最快畢業為目標，願意修滿學分上限
   * balanced —— 正常進度，兼顧負擔與時段
   * light    —— 這學期想輕一點，堂數越少越好
   */
  goal: "asap" | "balanced" | "light";
  /** 不排第 1 節（早八） */
  avoidEarly: boolean;
  /** 希望完全空出的星期（1=一 … 7=日） */
  avoidDays: number[];
  /** 本人設定的學期學分上限；未填則用學則上限 */
  maxCredits?: number;
  /** 期望堂數；balanced 目標下會盡量靠近這個數字 */
  targetCourseCount?: number;
  /** 希望課集中在少數幾天 */
  preferCompactDays: boolean;
  /** 使用者自填的補充說明，僅作呈現，不參與求解 */
  note?: string;
  /** 額外修業目標；不參與求解，但會影響畫面上要提醒哪些事 */
  extraGoals: ExtraGoal[];
};

export const DEFAULT_PREFERENCES: CoursePreferences = {
  goal: "balanced",
  avoidEarly: false,
  avoidDays: [],
  preferCompactDays: false,
  extraGoals: [],
};

export type Constraints = {
  avoidDays?: number[];
  /** 指定要空出的節次（docs/CONVERSATION.md §1.1 的 avoidPeriods） */
  avoidPeriods?: { day: number; periods: number[] }[];
  /** 早八：第 1 節 */
  avoidEarly?: boolean;
  maxCredits?: number;
  minCredits?: number;
  targetCourseCount?: number;
  /**
   * 堂數上限（硬限制）。「拿掉一堂通識」之後不能再自己補一門回來 —— 期望堂數只是偏好，
   * 那一類的學分還缺時排課會補，等於沒拿掉（TODO G12）
   */
  maxCourseCount?: number;
  preferCompactDays?: boolean;
  /** 課必須排在幾天內（硬限制）；preferCompactDays 只是盡量 */
  maxDays?: number;
  /** 使用者指定不要的課號 */
  excludeCourses?: string[];
  /** 使用者指定一定要留的課號 */
  pinCourses?: string[];
  /**
   * 「想修一堂 AI 相關的課」：至少要有一門出自這一組課號（TODO G2）。
   * 優先度僅次於學年課的下半，高於一般的缺口
   */
  wantOneOf?: string[];
  /** wantOneOf 的說法，如「AI 相關」，回覆與警告用 */
  wantLabel?: string;
  /** wantOneOf 的課希望排在哪幾天。那幾天都沒有班就不限（見 schedule.ts） */
  wantDays?: number[];
  /** 「多選一堂兩學分的課」：新加的課（眼前課表上沒有的）盡量是這個學分數。偏好，不是硬限制（TODO G1） */
  newCourseCredits?: number;
  /** 已排定、不可衝突的時段（如已登記之必修） */
  reserved?: { label: string; slots: TimeSlot[] }[];
};

/**
 * 某一門課為什麼沒有被排進來（docs/CONVERSATION.md §1.6）。
 * 這是使用者最常問的問題，也是求解器可以直接回答的 ——
 * 做好這一條，整個系統的可信度會明顯不同。
 */
export type ExclusionReason = {
  code: string;
  name: string;
  /** 在哪一步被排除 */
  step:
    | "not-offered"
    | "category-satisfied"
    | "prerequisite"
    | "no-seat"
    | "clash-reserved"
    | "avoid-day"
    | "avoid-period"
    | "excluded-by-user"
    /** 規劃表排在比較高的年級 */
    | "later-grade"
    /** 已經修過（或正在修） */
    | "already-taken"
    | "not-chosen"
    /** 問了一門其實已經排進去的課 */
    | "chosen";
  detail: string;
};

/**
 * 對話式微調的一次調整。
 * LLM 只負責把「不要早八」「少一堂課」解析成這個結構，之後一律重跑確定性求解。
 */
export type PlanAdjustment =
  | { type: "avoid-early"; value: boolean }
  | { type: "avoid-day"; day: 1 | 2 | 3 | 4 | 5 | 6 | 7; value: boolean }
  | { type: "course-count"; delta?: number; target?: number }
  | { type: "max-credits"; value: number }
  | { type: "compact-days"; value: boolean }
  | { type: "goal"; value: CoursePreferences["goal"] }
  | { type: "reset" };

export type AdjustmentOutcome = {
  /** 使用者原話 */
  raw: string;
  /** 解析出的調整；空陣列代表沒解析出任何可執行的調整 */
  adjustments: PlanAdjustment[];
  /** 解析不出來時的澄清問題或說明 */
  message?: string;
};

export type PlanCourse = {
  code: string;
  /** 哪一班（學校大綱系統的編號）。同一門課好幾班時，課綱頁靠它顯示課表上的那一班 */
  section?: number;
  name: string;
  credits: number;
  slotText: string;
  /** 供週課表格線使用；時段無法解析時為空陣列 */
  slots: TimeSlot[];
  teacher: string;
  category: string;
  categoryLabel: string;
  /** 修課餘額；null 表示開課資料沒有提供，不是額滿 */
  remaining: number | null;
  clash?: { with: string; alternative?: { code: string; name: string; slotText: string } };
  /** 低信心先修，僅提示不排除 */
  prereqWarning?: string;
};

export type Plan = {
  id: string;
  preset: Preset;
  label: string;
  /** 產生此方案時實際生效的條件，UI 上要能逐條看到 */
  appliedConstraints: string[];
  term: string;
  courses: PlanCourse[];
  totalCredits: number;
  unmetAfter: number;
  /** 為求解而放寬過的條件，一定要顯示 */
  relaxations: string[];
  /** 方案本身的提醒，如低於學期學分下限 */
  warnings: string[];
};

export type ExclusionSummary = {
  candidatesBeforeFilter: number;
  excludedBy: { reason: string; count: number; examples: string[] }[];
};

export type Infeasibility = {
  category: string;
  candidatesBeforeFilter: number;
  excludedBy: { reason: string; count: number; examples: string[] }[];
  conflictWith?: string;
  suggestion: string;
};

export type SolveResult =
  | { ok: true; plans: Plan[]; excluded: ExclusionSummary; relaxations: string[] }
  | { ok: false; infeasibilities: Infeasibility[]; excluded: ExclusionSummary; relaxations: string[] };

// ---------------------------------------------------------------- 外部內容攔截

export type BlockedContent = {
  sourceUrl: string;
  excerpt: string;
  patternMatched: string;
  blockedAt: string;
};

// ---------------------------------------------------------------- 情境試算

export type Scenario =
  /** 畢業時程 */
  | { type: "early-graduation"; targetTerm: string }
  | { type: "withdraw-course"; code: string }
  /** 下學期修某一門課：算哪一類、各類未修怎麼變、會不會落到待確認 */
  | { type: "take-course"; course: string }
  /** 加修另一套規定 */
  | { type: "add-minor"; dept: string }
  | { type: "double-major"; dept: string }
  | { type: "add-cert-program"; program: string }
  /** 改變學籍：一定會改變適用的規劃表版本 */
  | { type: "change-major"; dept: string }
  /** 門檻查詢 */
  | { type: "grade-threshold"; target: string };

export type IntentResult =
  | { kind: "scenario"; scenario: Scenario; raw: string }
  | { kind: "clarify"; question: string; raw: string }
  | { kind: "out-of-scope"; message: string; raw: string };

export type WhatIfResult = {
  headline: string;
  level: "feasible" | "infeasible" | "conditional";
  detail: string;
  alternatives: string[];
  citations: Citation[];
  uncountedHolds: number;
  /** 無解時說明哪兩個條件在打架 */
  conflict?: { a: string; b: string; explanation: string };
  /** 分段的細節（規定、你的進度、每學期要修多少、要注意）。有的話畫面用它，不用 detail */
  sections?: { title: string; lines: string[] }[];
};

// ---------------------------------------------------------------- Trace

export type ToolStatus = "ok" | "partial" | "failed";

export type ToolCall = {
  name: string;
  input: unknown;
  output: unknown;
  ms: number;
  status: ToolStatus;
  error?: string;
};

export type StepStatus = "ok" | "partial" | "retried" | "held" | "failed" | "skipped";

export type StepResult<T = unknown> = {
  idx: number;
  name: string;
  /** UI 上顯示的中文步驟名 */
  label: string;
  status: StepStatus;
  data?: T;
  /** trace 的那一行，寫成工程日誌 */
  summary: string;
  retries: number;
  ms: number;
  toolCalls: ToolCall[];
};

export type LlmUsage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type Trace = {
  id: string;
  createdAt: string;
  /** HMAC(學號)，不可逆 */
  studentHash: string;
  rulePackId: string;
  rulePackVersion: string;
  totalMs: number;
  status: "ok" | "held" | "error";
  steps: StepResult[];
  blockedContent: BlockedContent[];
  llm: LlmUsage;
  /** 中止原因（status === "error" 時） */
  abortReason?: string;
};
