import { DEFAULT_PREFERENCES, type CourseRecord, type Student, type StudentRecord, type Term } from "@/lib/types";

/**
 * 輔大資管 111 學年入學的示範學生。
 *
 * 修課紀錄取自一份真實的歷年成績單，**經本人同意**，且只取課名、學分、修課學期、選別：
 * 不含成績（score 一律 null）、學號、姓名。課號、開課單位、通識領域不是成績單上的
 * （輔大成績單沒有課號），是用 scripts/fju-sis-lookup.py 對學校課程查詢系統當學期的
 * 開課紀錄查回來的；yearLong 也是（課程查詢系統標「學年」的課）。原始成績單不進 repo。
 *
 * 課名照成績單的寫法（含「-英」「-網」尾碼、「web前端設計」的小寫），
 * 因為接上真實資料時引擎看到的就是這種寫法。
 *
 * 規則包是 Supabase 上鎖版的 fju-im-111（不進 repo，裡面有校對人姓名）。
 * 沒接 Supabase 的環境（CI、離線）找不到規則包，這兩個案例會顯示「尚未支援」——
 * 不會拿未核可的草稿來判定。
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
): CourseRecord {
  // 沒有成績：示範資料不放成績，也不編一個
  return { code, name, credits, year, term, selectType, status: "passed", score: null, ...opt };
}

const COURSES: CourseRecord[] = [
  // 111 學年（大一）
  c("00670", "現代數位攝影賞析", 2, 111, 1, "general", { generalDomain: "人文與藝術", offeringDept: "PT" }),
  c("00700", "世界古文明", 2, 111, 1, "general", { generalDomain: "人文與藝術", offeringDept: "PT" }),
  c("00001", "國文", 2, 111, 1, "required", { yearLong: true, offeringDept: "CT" }),
  c("00001", "國文", 2, 111, 2, "required", { yearLong: true, offeringDept: "CT" }),
  c("00155", "大學入門", 2, 111, 1, "required", { offeringDept: "IT" }),
  c("00764", "外國語文(中級英文)", 2, 111, 1, "required", { yearLong: true, offeringDept: "FT" }),
  c("00764", "外國語文(中級英文)", 2, 111, 2, "required", { yearLong: true, offeringDept: "FT" }),
  c("02390", "微積分", 3, 111, 1, "required", { yearLong: true, offeringDept: "IM", offeringCollege: "MGT" }),
  c("02390", "微積分", 3, 111, 2, "required", { yearLong: true, offeringDept: "IM", offeringCollege: "MGT" }),
  c("02412", "會計學", 3, 111, 1, "required", { yearLong: true, offeringDept: "IM", offeringCollege: "MGT" }),
  c("02412", "會計學", 3, 111, 2, "required", { yearLong: true, offeringDept: "IM", offeringCollege: "MGT" }),
  c("05201", "企業管理概論", 3, 111, 1, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("21020", "全民國防教育軍事訓練", 0, 111, 1, "required", { yearLong: true, offeringDept: "YT" }),
  c("21020", "全民國防教育軍事訓練", 0, 111, 2, "required", { yearLong: true, offeringDept: "YT" }),
  c("24495", "程式設計概論", 3, 111, 1, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("14761", "進階程式設計", 3, 111, 2, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("24496", "web前端設計", 2, 111, 2, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("00009", "體育", 0, 111, 1, "required", { offeringDept: "AT" }),
  c("00009", "體育", 0, 111, 2, "required", { offeringDept: "AT" }),
  c("01483", "行銷管理", 2, 111, 2, "elective", { offeringDept: "IM", offeringCollege: "MGT" }),
  // 112 學年（大二）
  c("31279", "試算表與程式設計", 2, 112, 1, "general", { generalDomain: "自然與科技", offeringDept: "NT" }),
  // 進修部開的通識，日間部學生跨部修
  c("00548", "電腦與課程學習", 2, 112, 2, "general", { generalDomain: "自然與科技", offeringDept: "NT" }),
  c("00772", "外國語文(基礎日文)", 2, 112, 1, "required", { yearLong: true, offeringDept: "FT" }),
  c("00772", "外國語文(基礎日文)", 2, 112, 2, "required", { yearLong: true, offeringDept: "FT" }),
  c("02222", "統計學", 3, 112, 1, "required", { yearLong: true, offeringDept: "IM", offeringCollege: "MGT" }),
  c("02222", "統計學", 3, 112, 2, "required", { yearLong: true, offeringDept: "IM", offeringCollege: "MGT" }),
  c("02457", "經濟學", 3, 112, 1, "required", { yearLong: true, offeringDept: "IM", offeringCollege: "MGT" }),
  c("02457", "經濟學", 3, 112, 2, "required", { yearLong: true, offeringDept: "IM", offeringCollege: "MGT" }),
  c("02490", "資料庫管理", 3, 112, 1, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("16258", "WEB程式設計", 3, 112, 1, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("30499", "創新與設計思考", 2, 112, 1, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("01584", "系統分析與設計", 3, 112, 2, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("02492", "資料結構", 3, 112, 2, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("10681", "資料通訊與網路", 3, 112, 2, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  // 大二的體育在成績單上是項目名稱
  c("06468", "保齡球", 0, 112, 1, "required", { offeringDept: "AT" }),
  c("06468", "保齡球", 0, 112, 2, "required", { offeringDept: "AT" }),
  c("19322", "雲端應用平台概論", 3, 112, 1, "elective", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("09514", "電子商務", 3, 112, 2, "elective", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("13027", "機器學習", 3, 112, 2, "elective", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("19411", "雲端應用程式設計", 3, 112, 2, "elective", { offeringDept: "IM", offeringCollege: "MGT" }),
  // 113 學年（大三）
  c("23470", "國際關係與亞太現勢", 2, 113, 1, "general", { generalDomain: "社會科學", offeringDept: "ST" }),
  c("00007", "人生哲學", 2, 113, 1, "required", { yearLong: true, offeringDept: "LT" }),
  c("00007", "人生哲學", 2, 113, 2, "required", { yearLong: true, offeringDept: "LT" }),
  c("01558", "作業系統", 3, 113, 1, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("04317", "資訊系統專題(一)", 3, 113, 1, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("02631", "管理資訊系統", 3, 113, 2, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("04038", "資訊系統專題(二)", 3, 113, 2, "required", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("01370", "生產與作業管理-英", 3, 113, 1, "elective", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("34084", "進階Web程式設計", 3, 113, 1, "elective", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("24498", "巨量資料概論", 3, 113, 2, "elective", { offeringDept: "IM", offeringCollege: "MGT" }),
  c("37079", "大語言模型-英", 3, 113, 2, "elective", { offeringDept: "IM", offeringCollege: "MGT" }),
  // 114 學年（大四）
  c("34179", "民主與社會", 2, 114, 1, "general", { generalDomain: "社會科學", offeringDept: "ST" }),
  c("13245", "寄生蟲與人生", 2, 114, 2, "general", { generalDomain: "自然與科技", offeringDept: "NT" }),
  c("08824", "專業倫理-企業倫理", 2, 114, 2, "required", { offeringDept: "ET" }),
  // 外系、學分學程開的選修（開課單位代碼照課程查詢系統）
  c("16688", "英文閱讀(二):新聞英文閱讀-英-網", 2, 114, 1, "elective", { offeringDept: "K80" }),
  c("33034", "物聯網概論與應用", 3, 114, 1, "elective", { offeringDept: "K28" }),
  c("37516", "電腦視覺實務與深度學習-網", 3, 114, 1, "elective", { offeringDept: "TG" }),
  c("37171", "生成式AI的人文導論-網", 3, 114, 2, "elective", { offeringDept: "TG" }),
  c("37868", "智慧製造執行系統-網", 3, 114, 2, "elective", { offeringDept: "TG" }),
];

const STUDENT: Student = {
  id: "S-FJU-IM111-A",
  school: "fju",
  dept: "IM",
  admissionYear: 111,
  actualAdmissionYear: 111,
  status: "enrolled",
  program: "day",
  maskedId: "FJU·····",
  displayName: "示範學生",
  className: "資管（日間部）",
};

/**
 * 成績單看得出來的畢業條件才填。資訊能力檢測、英文 B2、程式語言機測、導師時間
 * 成績單上沒有，照實留空 —— 系統會列為待確認，而不是推定通過。
 */
function evidence(courses: CourseRecord[]): StudentRecord["graduationEvidence"] {
  const peTerms = courses.filter((x) => x.offeringDept === "AT" && x.status === "passed").length;
  const emi = courses.filter((x) => x.offeringDept === "IM" && x.name.endsWith("-英") && x.status === "passed");
  const emiCredits = emi.reduce((a, x) => a + x.credits, 0);
  return {
    pe:
      peTerms >= 4
        ? { status: "passed", note: `成績單上體育 ${peTerms} 學期（含項目課），均及格。` }
        : { status: "not_passed", label: `${peTerms}/4 學期`, note: `成績單上體育 ${peTerms} 學期，規定 4 學期。` },
    emi:
      emiCredits >= 3
        ? { status: "passed", note: `已修本系英語授課課程 ${emiCredits} 學分（${emi.map((x) => x.name).join("、")}）。` }
        : { status: "not_passed", label: "未修", note: "成績單上還沒有本院開設的英語授課專業課程。" },
  };
}

function fjuRecord(student: Student, courses: CourseRecord[]): StudentRecord {
  return {
    student,
    courses,
    fetchedAt: new Date("2026-10-02T09:00:00+08:00").toISOString(),
    source: "mock",
    graduationEvidence: evidence(courses),
    preferences: { ...DEFAULT_PREFERENCES },
  };
}

const UPTO_YEAR2 = COURSES.filter((x) => x.year <= 112);

export const FJU_FIXTURES = [
  {
    id: "fju-im-111-full" as const,
    title: "輔大資管 111：四年修完（真實成績單）",
    tests: "真實規則與真實修課紀錄：全學年課程、外國語文開頭比對、國防看成績單、通識領域學分、超修不計",
    term: "114-2",
    record: fjuRecord({ ...STUDENT, className: "資管四（日間部）" }, COURSES),
  },
  {
    id: "fju-im-111-year2" as const,
    title: "輔大資管 111：大二結束、準備升大三",
    tests: "同一份成績單只到 112-2：還缺哪些、113-1 怎麼排（113-1 真實開課資料）",
    term: "112-2",
    record: fjuRecord({ ...STUDENT, id: "S-FJU-IM111-B", className: "資管二（日間部）" }, UPTO_YEAR2),
  },
];
