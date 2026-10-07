import { DEFAULT_PREFERENCES, type CourseRecord, type Student, type StudentRecord, type Term } from "@/lib/types";

/**
 * 輔大物理學系光電物理組 112 學年入學的示範學生（第二個真實系所）。
 *
 * 修課紀錄取自一份真實的歷年成績單（大一到大三），**經本人同意**，只取課名、學分、修課學期、選別，
 * 以及是否及格（不及格、停修會影響審查，只記狀態）：不含分數（score 一律 null）、學號、姓名。
 * 課號、開課單位、通識領域是用 scripts/fju-sis-lookup.py 對學校課程查詢系統查回來的；
 * 對到兩個課號的 4 門（微積分(一)(二)、專題研究(一)(二)）依必修科目表上印的課號。原始成績單不進 repo。
 *
 * 物理學系三個組的課（開課單位 55／56／1R）一律記成 PH：本系專業選修三組都算。
 * 規則包是 fju-phoe-112（docs/review/fju-phoe-112.draft.json），校對、鎖版前不會拿來判定。
 */

type Opt = Pick<CourseRecord, "offeringDept"> & Partial<Pick<CourseRecord, "generalDomain" | "offeringCollege" | "yearLong">>;

function c(
  code: string,
  name: string,
  credits: number,
  year: number,
  term: Term,
  selectType: CourseRecord["selectType"],
  opt: Opt,
  status: CourseRecord["status"] = "passed",
): CourseRecord {
  return { code, name, credits, year, term, selectType, status, score: null, ...opt };
}

const COURSES: CourseRecord[] = [
  // 112-1
  c("00750", "電影與精神心理健康", 2, 112, 1, "general", { offeringDept: "NT", generalDomain: "自然與科技" }),
  c("18457", "兩岸關係史", 2, 112, 1, "general", { offeringDept: "ST", generalDomain: "社會科學" }),
  c("00001", "國文", 2, 112, 1, "required", { offeringDept: "CT", yearLong: true }),
  c("00155", "大學入門", 2, 112, 1, "required", { offeringDept: "IT" }),
  c("00765", "外國語文(初級英文)", 2, 112, 1, "required", { offeringDept: "FT", yearLong: true }),
  c("02287", "普通物理實驗", 1, 112, 1, "required", { offeringDept: "33", yearLong: true }),
  c("02391", "微積分(一)", 3, 112, 1, "required", { offeringDept: "PH" }),
  c("14561", "普通物理(一)", 3, 112, 1, "required", { offeringDept: "33" }),
  c("21020", "全民國防教育軍事訓練", 0, 112, 1, "required", { offeringDept: "YT", yearLong: true }),
  c("32197", "普通化學(一)", 2, 112, 1, "required", { offeringDept: "33" }),
  c("32413", "普通化學實驗(一)", 1, 112, 1, "required", { offeringDept: "PH" }),
  c("00009", "體育", 0, 112, 1, "required", { offeringDept: "AT" }),
  // 112-2
  c("00001", "國文", 2, 112, 2, "required", { offeringDept: "CT", yearLong: true }),
  c("00765", "外國語文(初級英文)", 2, 112, 2, "required", { offeringDept: "FT", yearLong: true }),
  c("02287", "普通物理實驗", 1, 112, 2, "required", { offeringDept: "33", yearLong: true }),
  c("21020", "全民國防教育軍事訓練", 0, 112, 2, "required", { offeringDept: "YT", yearLong: true }),
  c("02392", "微積分(二)", 3, 112, 2, "required", { offeringDept: "PH" }),
  c("14562", "普通物理(二)", 3, 112, 2, "required", { offeringDept: "33" }),
  c("17841", "普通化學(二)", 2, 112, 2, "required", { offeringDept: "33" }),
  c("18630", "程式設計(一)", 3, 112, 2, "required", { offeringDept: "51" }),
  c("32414", "普通化學實驗(二)", 1, 112, 2, "required", { offeringDept: "PH" }),
  c("00009", "體育", 0, 112, 2, "required", { offeringDept: "AT" }),
  // 113-1
  c("00894", "環境藝術與生活", 2, 113, 1, "general", { offeringDept: "PT", generalDomain: "人文與藝術" }, "withdrawn"),
  c("36887", "親密關係探索", 2, 113, 1, "general", { offeringDept: "ST", generalDomain: "社會科學" }),
  c("00007", "人生哲學", 2, 113, 1, "required", { offeringDept: "LT", yearLong: true }),
  c("00911", "外國語文(中級英文閱讀)", 2, 113, 1, "required", { offeringDept: "FT" }),
  c("02532", "電子學(一)", 3, 113, 1, "required", { offeringDept: "PH" }),
  c("09201", "電磁學(一)", 3, 113, 1, "required", { offeringDept: "PH" }),
  c("30277", "電子學實驗(一)", 2, 113, 1, "required", { offeringDept: "PH" }),
  c("30403", "普通物理(三)", 3, 113, 1, "required", { offeringDept: "PH" }),
  c("32411", "應用數學(一)", 3, 113, 1, "required", { offeringDept: "PH" }),
  // 113-2
  c("00007", "人生哲學", 2, 113, 2, "required", { offeringDept: "LT", yearLong: true }),
  c("01751", "近代物理", 3, 113, 2, "required", { offeringDept: "PH" }, "failed"),
  c("02533", "電子學(二)", 3, 113, 2, "required", { offeringDept: "PH" }),
  c("02766", "線性代數", 2, 113, 2, "required", { offeringDept: "PH" }),
  c("04692", "專題研究(四)", 1, 113, 2, "required", { offeringDept: "PH" }),
  c("10428", "電磁學(二)", 3, 113, 2, "required", { offeringDept: "PH" }),
  c("30424", "外國語文(中級英文聽讀)", 2, 113, 2, "required", { offeringDept: "FT" }),
  c("31367", "電子學實驗(二)", 2, 113, 2, "required", { offeringDept: "PH" }),
  c("32412", "應用數學(二)", 3, 113, 2, "required", { offeringDept: "PH" }),
  c("37174", "光學設計軟體ZEMAX", 2, 113, 2, "elective", { offeringDept: "PH" }),
  // 114-1
  c("31279", "試算表與程式設計", 2, 114, 1, "general", { offeringDept: "NT", generalDomain: "自然與科技" }),
  c("01404", "光學", 3, 114, 1, "required", { offeringDept: "PH" }, "failed"),
  c("04880", "專題研究(一)", 1, 114, 1, "required", { offeringDept: "PH" }),
  c("18155", "統計物理", 3, 114, 1, "required", { offeringDept: "PH" }),
  c("21639", "量子物理(一)", 3, 114, 1, "required", { offeringDept: "PH" }, "failed"),
  c("31379", "實驗物理(三)", 2, 114, 1, "required", { offeringDept: "PH" }),
  c("34362", "TRX懸吊訓練", 0, 114, 1, "required", { offeringDept: "AT" }),
  c("19814", "專題演講(一)", 1, 114, 1, "elective", { offeringDept: "PH" }),
  c("36937", "半導體物理導論", 3, 114, 1, "elective", { offeringDept: "PH" }),
  // 114-2
  c("01403", "光電子學", 3, 114, 2, "required", { offeringDept: "PH" }),
  c("04655", "專題研究(二)", 1, 114, 2, "required", { offeringDept: "PH" }),
  c("08199", "專業倫理-科技倫理", 2, 114, 2, "required", { offeringDept: "ET" }),
  c("14150", "光電實驗", 2, 114, 2, "required", { offeringDept: "PH" }),
  c("31414", "幾何光學與光學設計", 3, 114, 2, "required", { offeringDept: "PH" }),
  c("06523", "真空鍍膜技術", 2, 114, 2, "elective", { offeringDept: "PH" }),
  c("19815", "專題演講(二)", 1, 114, 2, "elective", { offeringDept: "PH" }),
  c("30611", "物理英文", 2, 114, 2, "elective", { offeringDept: "PH" }),
  // 114 學年暑修（重修大二下、大三上沒過的兩門）
  c("01751", "近代物理-網", 3, 114, "summer", "required", { offeringDept: "PH" }),
  c("21639", "量子物理(一)-網", 3, 114, "summer", "required", { offeringDept: "PH" }),
];

const STUDENT: Student = {
  id: "S-FJU-PHOE112-A",
  school: "fju",
  dept: "PH",
  group: "光電物理組",
  admissionYear: 112,
  actualAdmissionYear: 112,
  status: "enrolled",
  program: "day",
  maskedId: "FJU·····",
  displayName: "示範學生",
  className: "光電三（日間部）",
};

/** 成績單看得出來的畢業條件：體育學期數（開課單位 AT，含大三的項目課） */
function evidence(courses: CourseRecord[]): StudentRecord["graduationEvidence"] {
  const peTerms = courses.filter((x) => x.offeringDept === "AT" && x.status === "passed").length;
  return {
    pe:
      peTerms >= 4
        ? { status: "passed", note: `成績單上體育 ${peTerms} 學期（含項目課），均及格。` }
        : { status: "not_passed", label: `${peTerms}/4 學期`, note: `成績單上體育 ${peTerms} 學期，規定 4 學期。` },
  };
}

const RECORD: StudentRecord = {
  student: STUDENT,
  courses: COURSES,
  fetchedAt: new Date("2026-10-08T09:00:00+08:00").toISOString(),
  source: "mock",
  graduationEvidence: evidence(COURSES),
  preferences: { ...DEFAULT_PREFERENCES },
};

export const FJU_PHY_FIXTURES = [
  {
    id: "fju-phoe-112-year3" as const,
    title: "輔大物理光電 112：大三結束、即將升大四",
    tests: "第二個真實系所：群組必修、本系專業選修三組都算、不及格與暑修重修、歷史與文化學群兩份文件不一致",
    term: "114-2",
    record: RECORD,
  },
];
