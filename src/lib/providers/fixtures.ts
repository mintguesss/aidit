import type { CoursePreferences, CourseRecord, StudentRecord, Student, Term } from "@/lib/types";
import { FJU_FIXTURES } from "./fixtures-fju";
import { FJU_PHY_FIXTURES } from "./fixtures-fju-phy";

/**
 * 合成學籍與修課資料。
 *
 * Demo 與評測一律使用本檔（docs/SPEC.md §9），不得出現真實學號、姓名或校名。
 * 每一份 fixture 的學分數都能以手算驗證，golden set 的標準答案即由人工對照而來。
 */

type Opt = Partial<Pick<CourseRecord, "generalDomain" | "score" | "waiverSource" | "offeringDept" | "offeringCollege" | "equivalentOf">>;

function c(
  code: string,
  name: string,
  credits: number,
  year: number,
  term: Term,
  selectType: CourseRecord["selectType"],
  status: CourseRecord["status"],
  opt: Opt = {},
): CourseRecord {
  return {
    code,
    name,
    credits,
    year,
    term,
    selectType,
    status,
    score: opt.score ?? (status === "passed" ? 80 : status === "failed" ? 45 : null),
    ...opt,
  };
}

const IM = { offeringDept: "IM", offeringCollege: "MGT" } as const;
const MGT_OTHER = (dept: string) => ({ offeringDept: dept, offeringCollege: "MGT" }) as const;

// ------------------------------------------------------------ 共用課程組

/** 校訂共同必修 20 學分，全數及格 */
const COMMON: CourseRecord[] = [
  c("GC1001", "國文（一）", 2, 111, 1, "required", "passed"),
  c("GC1002", "國文（二）", 2, 111, 2, "required", "passed"),
  c("GC1101", "英文（一）", 2, 111, 1, "required", "passed"),
  c("GC1102", "英文（二）", 2, 111, 2, "required", "passed"),
  c("GC1201", "公民素養", 3, 111, 1, "required", "passed"),
  c("GC1301", "體育（一）", 1, 111, 1, "required", "passed"),
  c("GC1302", "體育（二）", 1, 111, 2, "required", "passed"),
  c("GC1401", "服務學習", 1, 112, 1, "required", "passed"),
  c("GC1501", "資訊素養與倫理", 3, 111, 2, "required", "passed"),
  c("GC1601", "邏輯與批判思考", 3, 112, 1, "required", "passed"),
];

/** 院基礎必修 12 學分 */
const COLLEGE: CourseRecord[] = [
  c("BM2001", "管理學", 3, 111, 1, "required", "passed", MGT_OTHER("BA")),
  c("BM2002", "經濟學", 3, 111, 2, "required", "passed", MGT_OTHER("EC")),
  c("BM2003", "會計學", 3, 112, 1, "required", "passed", MGT_OTHER("AC")),
  c("BM2004", "統計學", 3, 112, 2, "required", "passed", MGT_OTHER("ST")),
];

/** 系專業必修：44 學分及格 + 專題研究（二）4 學分修課中 = 48 */
const MAJOR_REQUIRED: CourseRecord[] = [
  c("IM2001", "程式設計（一）", 3, 111, 1, "required", "passed", IM),
  c("IM2002", "程式設計（二）", 3, 111, 2, "required", "passed", IM),
  c("IM2003", "資料結構", 3, 112, 1, "required", "passed", IM),
  c("IM2004", "資料庫管理", 3, 112, 1, "required", "passed", IM),
  c("IM2005", "系統分析與設計", 3, 112, 2, "required", "passed", IM),
  c("IM3001", "計算機網路", 3, 112, 2, "required", "passed", IM),
  c("IM3002", "作業系統概論", 3, 113, 1, "required", "passed", IM),
  c("IM3003", "管理資訊系統", 3, 113, 1, "required", "passed", IM),
  // 演算法第一次不及格，次學期重修及格 —— 重補修不得重複採計
  c("IM3004", "演算法", 3, 113, 1, "required", "failed", IM),
  c("IM3004", "演算法", 3, 113, 2, "required", "passed", IM),
  c("IM3005", "軟體工程", 3, 113, 2, "required", "passed", IM),
  c("IM3006", "資訊安全概論", 3, 113, 2, "required", "passed", IM),
  c("IM3007", "電子商務", 3, 114, 1, "required", "passed", IM),
  c("IM3008", "專案管理", 3, 114, 1, "required", "passed", IM),
  c("IM4003", "企業資源規劃", 2, 114, 1, "required", "passed", IM),
  c("IM4001", "專題研究（一）", 3, 114, 1, "required", "passed", IM),
  c("IM4002", "專題研究（二）", 4, 114, 2, "required", "in_progress", IM),
];

/** 通識：及格 8 學分（人文藝術、社會科學、生命探索），修課中 2 學分；缺自然科技 */
const GENERAL: CourseRecord[] = [
  c("GE1101", "藝術鑑賞", 2, 111, 1, "general", "passed", { generalDomain: "人文藝術" }),
  c("GE1108", "文學與電影", 2, 112, 1, "general", "passed", { generalDomain: "人文藝術" }),
  c("GE1203", "社會學導論", 2, 112, 2, "general", "passed", { generalDomain: "社會科學" }),
  c("GE1305", "生命科學與倫理", 2, 113, 1, "general", "passed", { generalDomain: "生命探索" }),
  c("GE1210", "當代社會議題", 2, 114, 2, "general", "in_progress", { generalDomain: "社會科學" }),
];

/** 系專業選修：本系開設，及格 21 學分 */
const MAJOR_ELECTIVE: CourseRecord[] = [
  c("IM4011", "巨量資料分析", 3, 113, 1, "elective", "passed", IM),
  c("IM4012", "使用者介面設計", 3, 113, 2, "elective", "passed", IM),
  c("IM4013", "雲端運算服務", 3, 113, 2, "elective", "passed", IM),
  c("IM4014", "數位行銷分析", 3, 114, 1, "elective", "passed", IM),
  c("IM4015", "供應鏈資訊系統", 3, 114, 1, "elective", "passed", IM),
  c("IM4016", "決策支援系統", 3, 114, 1, "elective", "passed", IM),
  c("IM4017", "資訊系統稽核", 3, 114, 2, "elective", "passed", IM),
];

/** 院內他系選修：僅能歸自由選修，及格 18 學分（超修 6） */
const OTHER_DEPT_ELECTIVE: CourseRecord[] = [
  c("FN3001", "投資學", 3, 112, 2, "elective", "passed", MGT_OTHER("FN")),
  c("FN3002", "財務管理", 3, 113, 1, "elective", "passed", MGT_OTHER("FN")),
  c("FN3003", "金融科技導論", 3, 113, 2, "elective", "passed", MGT_OTHER("FN")),
  c("BA3001", "組織行為", 3, 113, 1, "elective", "passed", MGT_OTHER("BA")),
  c("BA3002", "人力資源管理", 3, 114, 1, "elective", "passed", MGT_OTHER("BA")),
  c("BA3003", "創新與創業", 3, 114, 1, "elective", "passed", MGT_OTHER("BA")),
];

/** 跨院選修：命中 cross-college ambiguity，整個移出指派問題 */
const CROSS_COLLEGE = c("ME4021", "智慧製造執行系統", 3, 114, 1, "elective", "passed", {
  offeringDept: "ME",
  offeringCollege: "ENG",
});

/** 抵免且課號已停開：命中 waiverWithoutMapping */
const WAIVED_RETIRED = c("IM1001", "計算機概論", 3, 111, 1, "elective", "waived", {
  ...IM,
  score: null,
  waiverSource: "前校修課抵免（111 學年度核定）",
});

// ------------------------------------------------------------------ 學生

const BASE_STUDENT: Student = {
  id: "S-DEMO-001",
  dept: "IM",
  admissionYear: 111,
  actualAdmissionYear: 111,
  status: "enrolled",
  program: "day",
  maskedId: "4114·····",
  displayName: "王○○",
  className: "資管四甲（日間部）",
};

/**
 * 學生於基本資料填寫的選課傾向。
 * 第一版課表即依此產生，之後才由使用者以對話微調。
 */
const PREFERENCES: CoursePreferences = {
  goal: "balanced",
  avoidEarly: true,
  avoidDays: [],
  targetCourseCount: 2,
  preferCompactDays: false,
  // 一般生沒有額外修業目標。有輔系／雙主修／學程的案例，
  // 是由 Student 的 minors / doubleMajors / certPrograms 表示 —— 那是校務系統的註冊事實，
  // 不該讓每個案例都繼承一份自行宣告的目標
  extraGoals: [],
  note: "下學期有校外實習，希望課不要排太散。",
};

const EVIDENCE: StudentRecord["graduationEvidence"] = {
  chinese: { status: "waived", label: "免測", note: "入學國文成績達免測標準。" },
  computing: { status: "passed", label: "通過", note: "113 學年度校內資訊能力檢定通過。" },
  service: { status: "passed", label: "已完成", note: "服務學習二學期成績及格。" },
};

function record(student: Student, courses: CourseRecord[], extra?: Partial<StudentRecord>): StudentRecord {
  return {
    student,
    courses,
    fetchedAt: new Date("2026-09-13T21:48:00+08:00").toISOString(),
    source: "mock",
    graduationEvidence: EVIDENCE,
    plannedCommitments: [{ label: "校外實習", slotText: "五 2-4" }],
    preferences: PREFERENCES,
    ...extra,
  };
}

// ------------------------------------------------------------- fixtures

export type FixtureId =
  | "demo"
  | "plain"
  | "overflow-no-transfer"
  | "transfer-student"
  | "transfer-approved"
  | "minor-student"
  | "waiver-retired"
  | "legacy-code"
  | "double-major"
  | "repeat-course"
  | "cross-college"
  | "domain-unmet-credits-ok"
  | "no-enrollment-data"
  | (typeof FJU_FIXTURES)[number]["id"]
  | (typeof FJU_PHY_FIXTURES)[number]["id"];

export type Fixture = {
  id: FixtureId;
  title: string;
  /** 這份資料在測什麼 */
  tests: string;
  /** 這個案例的「目前學期」；沒填用全站預設（114-2）。大二結束的案例是 112-2 */
  term?: string;
  /** 只給評測用，不出現在網站的示範學生選單 */
  evalOnly?: boolean;
  record: StudentRecord;
};

const DEMO_COURSES: CourseRecord[] = [
  ...COMMON,
  ...COLLEGE,
  ...MAJOR_REQUIRED,
  ...GENERAL,
  ...MAJOR_ELECTIVE,
  ...OTHER_DEPT_ELECTIVE,
  CROSS_COLLEGE,
  WAIVED_RETIRED,
];

/** 一般生：所有類別滿足，無待確認事項 */
const PLAIN_COURSES: CourseRecord[] = [
  ...COMMON,
  ...COLLEGE,
  ...MAJOR_REQUIRED.filter((x) => x.status !== "failed").map((x) =>
    x.code === "IM4002" ? { ...x, status: "passed" as const, score: 85 } : x,
  ),
  ...GENERAL.map((x) => (x.status === "in_progress" ? { ...x, status: "passed" as const, score: 82 } : x)),
  c("GE1401", "能源與永續社會", 2, 114, 2, "general", "passed", { generalDomain: "自然科技" }),
  ...MAJOR_ELECTIVE,
  c("IM4018", "區塊鏈應用", 3, 114, 2, "elective", "passed", IM),
  ...OTHER_DEPT_ELECTIVE.slice(0, 4),
];

export const FIXTURES: Fixture[] = [
  {
    id: "demo",
    title: "Demo 學生：超修不得流用 + 3 項待確認",
    tests: "不變式、超修不流用、跨院選修 ambiguity、抵免停開課號、通識領域分布、英文檢定無明文",
    record: record(BASE_STUDENT, DEMO_COURSES),
  },
  {
    id: "plain",
    title: "一般生：全數滿足",
    tests: "基準正確性",
    record: record({ ...BASE_STUDENT, id: "S-PLAIN-001", maskedId: "4114·····" }, PLAIN_COURSES),
  },
  {
    id: "overflow-no-transfer",
    title: "自由選修大量超修但系專選未達",
    tests: "超修不得流用至其他類別",
    record: record({ ...BASE_STUDENT, id: "S-OVER-001" }, [
      ...COMMON,
      ...COLLEGE,
      ...MAJOR_REQUIRED.filter((x) => x.status !== "failed").map((x) =>
        x.code === "IM4002" ? { ...x, status: "passed" as const, score: 85 } : x,
      ),
      ...GENERAL.map((x) => (x.status === "in_progress" ? { ...x, status: "passed" as const, score: 82 } : x)),
      c("GE1401", "能源與永續社會", 2, 114, 2, "general", "passed", { generalDomain: "自然科技" }),
      ...MAJOR_ELECTIVE.slice(0, 5),
      ...OTHER_DEPT_ELECTIVE,
      c("BA3004", "商業談判", 3, 114, 2, "elective", "passed", MGT_OTHER("BA")),
      c("FN3004", "國際金融", 3, 114, 2, "elective", "passed", MGT_OTHER("FN")),
    ]),
  },
  {
    id: "transfer-student",
    title: "轉系生：學籍入學學年與實際入學學年不同",
    tests: "是否正確轉人工而非硬算",
    record: record(
      { ...BASE_STUDENT, id: "S-TRANS-001", admissionYear: 111, actualAdmissionYear: 112 },
      DEMO_COURSES,
    ),
  },
  {
    id: "transfer-approved",
    title: "轉系生：已完成學分採計認定",
    tests: "認定完成後應正常判定，並標明依據哪一份認定",
    record: record(
      { ...BASE_STUDENT, id: "S-TRANS-002", admissionYear: 111, actualAdmissionYear: 112 },
      DEMO_COURSES,
      {
        transferApproval: {
          fromDept: "FN",
          toDept: "IM",
          approvedAt: "2024-09-02",
          approvedBy: "資訊管理學系系課程委員會",
          documentNo: "IM-TR-113-0007",
          accepted: [
            { code: "BM2002", countAs: "college-core" },
            { code: "BM2003", countAs: "college-core" },
            { code: "FN3001", countAs: "free-elective" },
            { code: "FN3002", countAs: "free-elective" },
          ],
        },
      },
    ),
  },
  {
    id: "minor-student",
    title: "輔系與學分學程學生",
    tests: "輔系與學程的判定與本系分開，且不得互相流用",
    record: record(
      {
        ...BASE_STUDENT,
        id: "S-MINOR-001",
        minors: ["FN"],
        certPrograms: ["資訊安全"],
      },
      DEMO_COURSES,
    ),
  },
  {
    id: "waiver-retired",
    title: "抵免課號已停開且查無對照",
    tests: "HoldItem 產生、該筆不計入任何類別",
    record: record({ ...BASE_STUDENT, id: "S-WAIVE-001" }, [
      ...PLAIN_COURSES,
      WAIVED_RETIRED,
    ]),
  },
  {
    id: "legacy-code",
    title: "修過舊課號且已公告對照",
    tests: "舊課號對照後應正確歸入必修類別",
    record: record({ ...BASE_STUDENT, id: "S-LEGACY-001" }, [
      ...PLAIN_COURSES.filter((x) => x.code !== "IM2003"),
      c("IM2903", "資料結構與演算法導論", 3, 112, 1, "required", "passed", {
        ...IM,
        equivalentOf: "IM2003",
      }),
    ]),
  },
  {
    id: "double-major",
    title: "雙主修學生",
    tests: "雙主修科目之類別歸屬不得影響本系判定",
    record: record({ ...BASE_STUDENT, id: "S-DBL-001", doubleMajors: ["FN"] }, [
      ...PLAIN_COURSES,
      c("FN4001", "衍生性金融商品", 3, 114, 1, "elective", "passed", MGT_OTHER("FN")),
      c("FN4002", "財務工程", 3, 114, 2, "elective", "passed", MGT_OTHER("FN")),
    ]),
  },
  {
    id: "repeat-course",
    title: "同一門課重複及格紀錄",
    tests: "重補修不得重複採計",
    record: record({ ...BASE_STUDENT, id: "S-REPEAT-001" }, [
      ...PLAIN_COURSES,
      c("IM4011", "巨量資料分析", 3, 114, 2, "elective", "passed", IM),
    ]),
  },
  {
    id: "cross-college",
    title: "跨院選修",
    tests: "ambiguity trigger 命中、impact 計算",
    record: record({ ...BASE_STUDENT, id: "S-CROSS-001" }, [
      ...PLAIN_COURSES.filter((x) => x.code !== "IM4018"),
      CROSS_COLLEGE,
    ]),
  },
  {
    id: "domain-unmet-credits-ok",
    title: "通識學分已足但領域分布未達",
    tests: "subRule 判定：學分足仍不得視為滿足",
    record: record({ ...BASE_STUDENT, id: "S-DOMAIN-001" }, [
      ...PLAIN_COURSES.filter((x) => x.code !== "GE1401"),
      c("GE1109", "西洋美術史", 2, 114, 2, "general", "passed", { generalDomain: "人文藝術" }),
    ]),
  },
  {
    id: "no-enrollment-data",
    title: "資料來源不含修課中資料",
    tests: "capabilities 缺項應進 holds，不得猜測",
    record: record({ ...BASE_STUDENT, id: "S-NOENR-001" }, DEMO_COURSES.filter((x) => x.status !== "in_progress")),
  },
  // 輔大資管 111：真實規則＋真實修課紀錄（只有課名、學分、學期），見 fixtures-fju.ts
  ...FJU_FIXTURES,
  ...FJU_PHY_FIXTURES,
];

export function fixture(id: FixtureId): Fixture {
  const f = FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`查無 fixture：${id}`);
  return f;
}
