/**
 * 輔大的額外修業規定（雙主修、學分學程），格式見 extra-packs.ts。
 *
 * 全部來自學校公開的文件，原文抄錄在 corpus/ 下，每一條都附得出 quote：
 *   - 雙主修辦法（教務處）：雙主修要修滿加修學系全部專業必修，且不少於 40 學分（第五條）；
 *     依開始修讀那一年該系入學生的必修科目表（第六條）；與主系相同或高度相似的課可申請免修，由雙主修學系主任認定（第六條）
 *   - 物理系：光電物理組必修科目表（110～112 學年度入學生適用）。物理系若另有雙主修專用科目表，目前未收錄
 *   - 心理系：雙學位學生必修課程一覽表（109 學年度起雙主修學生適用）
 *   - 雲端服務學程：課程一覽表（112 學年起適用）
 *
 * 2026-10-12 逐字對照原檔影像校對（條文、科目名稱、學分；各表的學分加總也對過），使用者確認後鎖版為 approved。
 * 物理系分組的但書（caveat）不是抄錄問題，鎖版後照樣在結果裡講。
 * 這裡刻意寫成 unknown[]，由 extra-packs.ts 的 schema 驗證，避免兩個檔案互相 import 型別。
 */

const DOUBLE_MAJOR_RULE = {
  overlapPolicy:
    "依學校雙主修辦法：除修滿本系最低畢業學分外，須實際修滿雙主修學系全部專業必修科目學分，且不得少於 40 學分；雙主修學分不得認定為本系畢業學分。",
  overlapCitation: {
    docId: "fju-double-major",
    locator: "第五條",
    quote: "並應實際修滿雙主修學系全部專業（門）必修科目學分，且不得少於四十學分。雙主修學分不得認定為主系畢業學分。",
  },
  waiverByName: {
    citation: {
      docId: "fju-double-major",
      locator: "第六條",
      quote: "雙主修學系與其主學系科目相同或高度相似之課程得辦理免修。",
    },
  },
};

const PH_REQUIRED = [
  "02391", "02392", "20538", "14561", "14562", "18630", "09201", "10428", "02532", "02533",
  "32411", "32412", "32197", "17841", "02287", "32413", "32414", "30403", "01751", "02766",
  "30277", "31379", "21639", "01404", "31414", "01403", "14150", "01947",
];

/** 113 學年度起光電物理組取消普通化學(二)、普通化學實驗(二)（必修 69 → 66） */
const PH_REQUIRED_113 = PH_REQUIRED.filter((c) => c !== "17841" && c !== "32414");
const PH_GROUP = ["04880", "04655", "04903", "04692", "18607", "31367", "31366", "31445", "22672", "18155"];

const PH_NAMES: Record<string, string> = {
          "02391": "微積分(一)", "02392": "微積分(二)", "20538": "微積分-英", "14561": "普通物理(一)",
          "14562": "普通物理(二)", "18630": "程式設計(一)", "09201": "電磁學(一)", "10428": "電磁學(二)",
          "02532": "電子學(一)", "02533": "電子學(二)", "32197": "普通化學(一)", "17841": "普通化學(二)",
          "02287": "普通物理實驗", "01751": "近代物理", "02766": "線性代數", "21639": "量子物理(一)",
          "01404": "光學", "31414": "幾何光學與光學設計", "01403": "光電子學", "14150": "光電實驗", "01947": "書報討論",
          // 科目表原文沒印課號，以下由學校課程查詢系統（113-1 開課與物理系成績單）對出
          "32411": "應用數學(一)", "32412": "應用數學(二)", "32413": "普通化學實驗(一)", "32414": "普通化學實驗(二)",
          "30403": "普通物理(三)", "30277": "電子學實驗(一)", "31379": "實驗物理(三)",
          // 群組必修
          "04880": "專題研究(一)", "04655": "專題研究(二)", "04903": "專題研究(三)", "04692": "專題研究(四)",
          "18607": "理論力學(一)", "31367": "電子學實驗(二)", "31366": "電磁學(三)", "31445": "進階實驗物理",
          "22672": "量子物理(二)", "18155": "統計物理",
        };

/** 輔系：跟本系相同的科目不算輔系學分，要另選補足（輔系辦法第十二條）—— 跟雙主修的「可申請免修」不一樣 */
const minorSameName = (dept: string) => ({
  waiverByName: {
    text: `跟本系相同的科目不能算輔系學分，要經${dept}主任同意，另選其他${dept}的科目補足。`,
    citation: {
      docId: "fju-minor",
      locator: "第十二條",
      quote: "各輔系專業（門）科目如與主系專業（門）科目相同時，不得計算為輔系學分",
    },
  },
});

const MINOR_RULE = {
  overlapPolicy: "依學校輔系辦法：輔系學分要在本系最低畢業學分以外加修；跟本系相同的專業科目不能算輔系學分。",
  overlapCitation: { docId: "fju-minor", locator: "第五條", quote: "輔系學分，應在主系規定最低畢業學分以外加修之" },
};

/**
 * 電子商務學分學程（資管系辦公室承辦）。每學年的課程設計不一樣，依申請那一學年選版本：
 *   112、113 學年同一套；114 起行銷管理移到電子商務應用課程，選修拿掉知識探索與資料採擷、量化交易系統，
 *   加入智慧零售管理、智慧零售；115 再拿掉全球運籌與供應鏈。
 * 模組（織品服飾應用、電子商務應用）多修的學分可以認列為選修，所以選修的課名清單把模組的課也放進去。
 */
function ecProgram(year: 112 | 114 | 115): unknown {
  const textile = ["織品服飾工商業導論", "服飾零售學", "服飾物流與管理", "織品服飾商品消費學"];
  const ecApps = year >= 114 ? ["商業自動化", "網路行銷", "行銷管理", "數位金融"] : ["商業自動化", "網路行銷", "數位金融"];
  const electives = [
    "消費者行為", "國際企業管理", "服飾商店管理", "織品服飾採購", "服飾消費心理", "時尚消費專題",
    ...(year >= 114 ? ["智慧零售管理", "智慧零售"] : ["行銷管理", "知識探索與資料採擷", "量化交易系統"]),
    "行銷專業實習", "服飾專業實習", "織品專業實習", "服務科學", "雲端應用平台概論", "程式設計概論", "供應鏈管理",
    ...(year <= 114 ? ["全球運籌與供應鏈"] : []),
  ];
  const label = year === 112 ? "112、113" : String(year);
  return {
    id: `fju-ec-program-${year}`,
    school: "fju",
    kind: "cert-program",
    program: "電子商務學程",
    title: `電子商務學分學程（${label} 學年課程設計）`,
    admissionYear: year,
    version: "1",
    provenance: "approved",
    minCredits: 20,
    document: { id: "fju-ec-program", title: "輔仁大學電子商務學分學程規則與課程設計", publishedAt: "", corpusFile: "fju-ec-program.txt" },
    requirements: [
      {
        id: "core",
        label: "共同必修：電子商務",
        credits: 3,
        match: { type: "courseNames", names: ["電子商務"] },
        citation: { docId: "fju-ec-program", locator: `${year} 學年課程設計`, quote: "必修基礎課程（ 3 學分） 織品服飾應用課程（ 2 學分） 電子商務（ 3 學分）" },
      },
      {
        id: "textile",
        label: "織品服飾應用課程（至少 2 學分）",
        credits: 2,
        match: { type: "courseNames", names: textile },
        citation: { docId: "fju-ec-program", locator: `${year} 學年課程設計`, quote: "需至少修滿 2 學分；多選之學分可認列為選修學分" },
      },
      {
        id: "ec-apps",
        label: "電子商務應用課程（至少 5 學分）",
        credits: 5,
        match: { type: "courseNames", names: ecApps },
        citation: { docId: "fju-ec-program", locator: `${year} 學年課程設計`, quote: "需至少修滿 5 學分；多選之學分可認列為選修學分" },
      },
      {
        id: "electives",
        label: "電子商務相關選修",
        credits: 10,
        match: { type: "courseNames", names: [...electives, ...textile, ...ecApps] },
        citation: { docId: "fju-ec-program", locator: `${year} 學年課程設計`, quote: "電子商務相關選修課程（ 10 學分）" },
      },
    ],
    overlapPolicy: "學程科目學分中，至少一半不能是本系的必修。",
    overlapCitation: { docId: "fju-program-setup", locator: "第四條", quote: "學生修習學分學程科目學分中，至少有1/2比例之學分數不得為學生主系、所、雙主修學系及輔系之必修學分" },
    nonMainRequiredShare: {
      min: 0.5,
      citation: { docId: "fju-program-setup", locator: "第四條", quote: "學生修習學分學程科目學分中，至少有1/2比例之學分數不得為學生主系、所、雙主修學系及輔系之必修學分" },
    },
    apply: {
      text: "依每年公告的時程，到學生資訊入口網「學籍註冊 → 跨領域學習申請 → 學分學程申請」填申請表，列印後經本系主管簽准，連同歷年成績單正本交到資管系辦公室（利瑪竇 LM306）。限學業成績沒有被 1/2 的紀錄；名額 60 名，隨班附讀、須達 20 人才成立。",
      citation: { docId: "fju-ec-program", locator: "申請方式及開班要求", quote: "限學業成績無1/2不及格學分數紀錄" },
    },
  };
}

export const FJU_EXTRA_PACKS: unknown[] = [
  {
    id: "fju-ph-double-major-110",
    school: "fju",
    kind: "double-major",
    dept: "PH",
    title: "物理學系雙主修（110～112 學年度開始修讀：以光電物理組該屆必修科目表為準）",
    caveat:
      "物理系沒有另訂雙主修科目表，依雙主修辦法第六條以該系入學生的必修科目為準；物理系分物理組、光電物理組、電子物理組，群組必修各不相同，這裡以光電物理組計算，實際以申請的組別為準。",
    admissionYear: 110,
    version: "1",
    provenance: "approved",
    minCredits: 72,
    document: {
      id: "fju-phy-oe-plan-110",
      title: "輔仁大學物理系必修科目表（適 110～112 入學，光電物理組）",
      publishedAt: "",
      corpusFile: "fju-phy-oe-plan-110.txt",
    },
    requirements: [
      {
        id: "dept-required",
        label: "物理系專業必修",
        credits: 69,
        match: { type: "courseList", codes: PH_REQUIRED },
        names: PH_NAMES,
        citation: { docId: "fju-phy-oe-plan-110", locator: "第 2 頁 學分統計", quote: "必修  69" },
      },
      {
        id: "group-required",
        label: "光電物理組群組必修",
        credits: 3,
        match: { type: "courseList", codes: ["04880", "04655", "04903", "04692", "18607", "31367", "31366", "31445", "22672", "18155"] },
        names: {
          "04880": "專題研究(一)", "04655": "專題研究(二)", "04903": "專題研究(三)", "04692": "專題研究(四)",
          "18607": "理論力學(一)", "31367": "電子學實驗(二)", "31366": "電磁學(三)", "31445": "進階實驗物理",
          "22672": "量子物理(二)", "18155": "統計物理",
        },
        citation: { docId: "fju-phy-oe-plan-110", locator: "第 2 頁 群組必修備註", quote: "群組必修至少3學分" },
      },
    ],
    ...DOUBLE_MAJOR_RULE,
  },
  {
    id: "fju-psy-double-major-109",
    school: "fju",
    kind: "double-major",
    // 心理學系在學校課程系統的開課單位代碼
    dept: "39",
    title: "心理學系雙主修（109 學年度起雙主修學生適用）",
    caveat: "各科的擋修及選課限制，依心理系課程委員會的規定。",
    admissionYear: 109,
    version: "1",
    provenance: "approved",
    minCredits: 64,
    document: {
      id: "fju-psy-double-major-109",
      title: "心理學系雙學位學生必修課程一覽表（109 學年度起雙主修學生適用）",
      publishedAt: "",
      corpusFile: "fju-psy-double-major-109.txt",
    },
    requirements: [
      {
        id: "core",
        label: "心理系核心課程（54 學分中選 42）",
        credits: 42,
        match: {
          type: "courseNames",
          names: [
            "認知神經科學導論", "演化心理學", "普通心理學", "統計學", "敘說、反映與實踐導論", "心理測驗", "心理學實驗法",
            "心理實驗法實驗", "社會學", "經濟學", "人類學習與認知", "知覺心理學", "發展心理學", "生理心理學", "社會心理學",
            "人格心理學", "變態心理學",
          ],
        },
        deptOnly: true,
        citation: { docId: "fju-psy-double-major-109", locator: "第二點", quote: "核心課程（須於以下54學分中必選42學分）" },
      },
      {
        id: "elective",
        label: "心理系開設課程",
        credits: 22,
        match: { type: "deptElective", dept: "39" },
        citation: { docId: "fju-psy-double-major-109", locator: "第一點", quote: "其餘學分可自由選修心理系開設課程" },
      },
    ],
    ...DOUBLE_MAJOR_RULE,
  },
  {
    id: "fju-cloud-program-112",
    school: "fju",
    kind: "cert-program",
    program: "雲端服務學程",
    title: "雲端服務學程（112 學年起適用）",
    admissionYear: 112,
    version: "1",
    provenance: "approved",
    minCredits: 20,
    document: {
      id: "fju-cloud-program-112",
      title: "雲端服務學程課程一覽表（112 學年起適用）",
      publishedAt: "",
      corpusFile: "fju-cloud-program-112.txt",
    },
    requirements: [
      {
        id: "required",
        label: "學程必修",
        credits: 3,
        minCourses: 1,
        match: { type: "courseNames", names: ["雲端應用平台概論"] },
        citation: { docId: "fju-cloud-program-112", locator: "課程清單", quote: "學程必修：雲端應用平台概論 3" },
      },
      {
        id: "core",
        label: "核心選修（3 門）",
        credits: 9,
        minCourses: 3,
        match: {
          type: "courseNames",
          names: [
            "企業資源規劃", "行動式雲端服務應用設計", "響應式雲端服務系統開發", "Web程式設計", "行動商務應用系統",
            "雲端應用程式設計", "統計軟體應用", "資料採礦", "知識探索與資料採擷", "Web前端設計", "巨量資料概論",
          ],
        },
        citation: { docId: "fju-cloud-program-112", locator: "課程清單", quote: "核心選修課程(選修3門)" },
      },
      {
        id: "elective",
        label: "選修（3 門）",
        credits: 9,
        minCourses: 3,
        match: {
          type: "courseNames",
          names: [
            "資料庫管理", "資訊安全", "成本與管理會計", "生產與作業管理", "物流與供應鏈管理", "顧客關係管理",
            "創新與創業管理", "創新管理", "物聯網概論與應用", "智慧稽核與數據分析", "空間資訊管理",
          ],
        },
        citation: { docId: "fju-cloud-program-112", locator: "課程清單", quote: "選修課程(選修3門)" },
      },
    ],
    overlapPolicy: "學程科目學分中，至少一半不得是主系、雙主修學系或輔系的必修學分。",
    overlapCitation: {
      docId: "fju-cloud-program-112",
      locator: "附註",
      quote: "至少有1/2比例之學分數不得為學生主系、所、雙主修學系及輔系之必修學分",
    },
    nonMainRequiredShare: {
      min: 0.5,
      citation: {
        docId: "fju-cloud-program-112",
        locator: "附註",
        quote: "至少有1/2比例之學分數不得為學生主系、所、雙主修學系及輔系之必修學分",
      },
    },
    apply: {
      text: "教務處公告的申請期間內，把申請表和歷年成績單正本交到資管系辦公室（利瑪竇 LM306）。限學業成績沒有被 1/2 的紀錄；學程以隨班附讀為原則，須達 20 人才成立。",
      citation: {
        docId: "fju-cloud-program-112",
        locator: "申請方式及開班要求",
        quote: "將申請表及歷年成績單正本交至資管系辦公室利瑪竇LM306",
      },
    },
  },
  {
    id: "fju-ph-minor-110",
    school: "fju",
    kind: "minor",
    dept: "PH",
    title: "物理學系輔系（110～112 學年度：以物理系專業必修科目為依據）",
    caveat:
      "物理系沒有另訂輔系科目表，依輔系辦法第三、四條：輔系課程以該系專業必修科目為依據，至少修畢 20 學分；實際可修哪些科目由物理系認定。",
    admissionYear: 110,
    version: "1",
    provenance: "approved",
    minCredits: 20,
    document: {
      id: "fju-phy-oe-plan-110",
      title: "輔仁大學物理系必修科目表（適 110～112 入學，光電物理組）",
      publishedAt: "",
      corpusFile: "fju-phy-oe-plan-110.txt",
    },
    requirements: [
      {
        id: "dept-required",
        label: "物理系專業必修",
        credits: 20,
        match: { type: "courseList", codes: PH_REQUIRED },
        names: PH_NAMES,
        citation: { docId: "fju-minor", locator: "第四條", quote: "至少應修畢輔系專業（門）必修科目二十學分" },
      },
    ],
    ...MINOR_RULE,
    ...minorSameName("物理學系"),
  },
  {
    id: "fju-psy-minor-112",
    school: "fju",
    kind: "minor",
    dept: "39",
    title: "心理學系輔系（112 學年度輔系必選修科目表）",
    admissionYear: 112,
    version: "1",
    provenance: "approved",
    minCredits: 24,
    document: {
      id: "fju-psy-minor-112",
      title: "輔仁大學 112 學年度心理學系輔系必（選）修科目表",
      publishedAt: "",
      corpusFile: "fju-psy-minor-112.txt",
    },
    requirements: [
      { id: "general", label: "普通心理學", credits: 6, deptOnly: true, match: { type: "courseNames", names: ["普通心理學"] },
        citation: { docId: "fju-psy-minor-112", locator: "科目表", quote: "普通心理學 General psychology 必 規定學分6" } },
      { id: "stat", label: "統計學", credits: 6, deptOnly: true, match: { type: "courseNames", names: ["統計學"] },
        citation: { docId: "fju-psy-minor-112", locator: "科目表", quote: "統計學 Statistics 必 規定學分6" } },
      { id: "narrative", label: "敘說、反映與實踐導論", credits: 3, deptOnly: true, match: { type: "courseNames", names: ["敘說、反映與實踐導論"] },
        citation: { docId: "fju-psy-minor-112", locator: "科目表", quote: "敘說、反映與實踐導論 The Introduction of Narration,Reflection & Practice 必 規定學分3" } },
      { id: "test", label: "心理測驗", credits: 3, deptOnly: true, match: { type: "courseNames", names: ["心理測驗"] },
        citation: { docId: "fju-psy-minor-112", locator: "科目表", quote: "心理測驗 Psychological Test 必 規定學分3" } },
      { id: "dev-or-social", label: "發展心理學或社會心理學（二選一）", credits: 3, minCourses: 1, deptOnly: true,
        match: { type: "courseNames", names: ["發展心理學", "社會心理學"] },
        citation: { docId: "fju-psy-minor-112", locator: "科目表", quote: "「發展心理學」與「社會心理學」為二選一之必選課程" } },
      { id: "guidance-or-io", label: "輔導與諮商概論或工商心理學概論（二選一）", credits: 3, minCourses: 1, deptOnly: true,
        match: { type: "courseNames", names: ["輔導與諮商概論", "工商心理學概論"] },
        citation: { docId: "fju-psy-minor-112", locator: "科目表", quote: "「輔導與諮商概論」與「工商心理學概論」為二選一之必選課程" } },
    ],
    ...MINOR_RULE,
    ...minorSameName("心理學系"),
  },
  {
    id: "fju-ph-double-major-113",
    school: "fju",
    kind: "double-major",
    dept: "PH",
    title: "物理學系雙主修（113 學年度起開始修讀：以光電物理組該屆必修科目表為準）",
    caveat:
      "物理系沒有另訂雙主修科目表，依雙主修辦法第六條以開始修讀那一年該系入學生的必修科目為準；物理系分物理組、光電物理組、電子物理組，群組必修各不相同，這裡以光電物理組計算，實際以申請的組別為準。",
    admissionYear: 113,
    version: "1",
    provenance: "approved",
    minCredits: 69,
    document: {
      id: "fju-phy-oe-plan-113",
      title: "輔仁大學 113 學年度物理學系必修科目表（光電物理組）",
      publishedAt: "",
      corpusFile: "fju-phy-oe-plan-113.txt",
    },
    requirements: [
      {
        id: "dept-required",
        label: "物理系專業必修",
        credits: 66,
        match: { type: "courseList", codes: PH_REQUIRED_113 },
        names: PH_NAMES,
        citation: { docId: "fju-phy-oe-plan-113", locator: "學分統計", quote: "必修 66" },
      },
      {
        id: "group-required",
        label: "光電物理組群組必修",
        credits: 3,
        match: { type: "courseList", codes: PH_GROUP },
        names: PH_NAMES,
        citation: { docId: "fju-phy-oe-plan-113", locator: "群組必修備註", quote: "群組必修至少3學分" },
      },
    ],
    ...DOUBLE_MAJOR_RULE,
  },
  {
    id: "fju-ph-minor-113",
    school: "fju",
    kind: "minor",
    dept: "PH",
    title: "物理學系輔系（113 學年度起：以物理系專業必修科目為依據）",
    caveat:
      "物理系沒有另訂輔系科目表，依輔系辦法第三、四條：輔系課程以該系專業必修科目為依據，至少修畢 20 學分；實際可修哪些科目由物理系認定。",
    admissionYear: 113,
    version: "1",
    provenance: "approved",
    minCredits: 20,
    document: {
      id: "fju-phy-oe-plan-113",
      title: "輔仁大學 113 學年度物理學系必修科目表（光電物理組）",
      publishedAt: "",
      corpusFile: "fju-phy-oe-plan-113.txt",
    },
    requirements: [
      {
        id: "dept-required",
        label: "物理系專業必修",
        credits: 20,
        match: { type: "courseList", codes: PH_REQUIRED_113 },
        names: PH_NAMES,
        citation: { docId: "fju-minor", locator: "第四條", quote: "至少應修畢輔系專業（門）必修科目二十學分" },
      },
    ],
    ...MINOR_RULE,
    ...minorSameName("物理學系"),
  },
  {
    id: "fju-psy-double-major-113",
    school: "fju",
    kind: "double-major",
    dept: "39",
    title: "心理學系雙主修（113 學年度起雙主修學生適用）",
    caveat: "各科的擋修及選課限制，依心理系課程委員會的規定。",
    admissionYear: 113,
    version: "1",
    provenance: "approved",
    minCredits: 64,
    document: {
      id: "fju-psy-double-major-113",
      title: "輔仁大學心理學系雙學位學生必修課程一覽表（113 學年度起雙主修學生適用）",
      publishedAt: "",
      corpusFile: "fju-psy-double-major-113.txt",
    },
    requirements: [
      {
        id: "core",
        label: "心理系核心課程（57 學分中選 45）",
        credits: 45,
        match: {
          type: "courseNames",
          names: [
            "認知神經科學導論", "普通心理學", "統計學", "AI時代的AI心理學應用", "敘說、反映與實踐導論", "工商心理學概論",
            "心理測驗", "心理學實驗法", "心理實驗法實驗", "社會學", "經濟學", "發展心理學", "生理心理學", "變態心理學",
            "人格心理學", "人類學習與認知", "知覺心理學", "社會心理學",
          ],
        },
        deptOnly: true,
        citation: { docId: "fju-psy-double-major-113", locator: "第二點", quote: "核心課程（須於以下57學分中必選45學分）" },
      },
      {
        id: "elective",
        label: "心理系開設課程",
        credits: 19,
        match: { type: "deptElective", dept: "39" },
        citation: { docId: "fju-psy-double-major-113", locator: "第一點", quote: "其餘學分可自由選修心理系開設課程" },
      },
    ],
    ...DOUBLE_MAJOR_RULE,
  },
  {
    id: "fju-ai-micro-114",
    school: "fju",
    kind: "cert-program",
    program: "AI微學程",
    title: "AI 微學程（科目表適用 109 學年度起申請者）",
    caveat: "科目表註明「科目名稱與科目代碼不符者，以科目名稱為準」；名稱不同但性質相同的課，由學程召集人認定（規則第五條）。",
    admissionYear: 109,
    version: "1",
    provenance: "approved",
    minCredits: 12,
    document: {
      id: "fju-ai-micro-114",
      title: "輔仁大學 AI 微學程規則及課程科目表",
      publishedAt: "2025-03-17",
      corpusFile: "fju-ai-micro-114.txt",
    },
    requirements: [
      {
        id: "intro",
        label: "基礎：程式設計概論",
        credits: 3,
        minCourses: 1,
        match: { type: "courseNames", names: ["程式設計概論"] },
        citation: { docId: "fju-ai-micro-114", locator: "課程科目表", quote: "程式設計概論 Introduction to Programming 24495 必 3" },
      },
      {
        id: "basic",
        label: "基礎（3 選 1）",
        credits: 3,
        minCourses: 1,
        match: { type: "courseNames", names: ["巨量資料探勘", "巨量資料概論", "人工智慧"] },
        citation: { docId: "fju-ai-micro-114", locator: "課程科目表", quote: "至少取得1科學分(3選1)" },
      },
      {
        id: "advanced",
        label: "進階（3 選 2）",
        credits: 6,
        minCourses: 2,
        match: { type: "courseNames", names: ["深度學習導論與應用", "機器學習", "大語言模型"] },
        citation: { docId: "fju-ai-micro-114", locator: "課程科目表", quote: "至少取得2科學分(3選2)" },
      },
    ],
    overlapPolicy: "學程學分至少一半不能是本系、雙主修學系或輔系的必修；本系必修超過 6 學分的部分不承認，要另修其他課。",
    overlapCitation: {
      docId: "fju-ai-micro-114",
      locator: "第四條",
      quote: "修讀學分中若包含學生主系、所、雙主修學系及輔系之必修學分超出6學分，則僅承認6學分",
    },
    nonMainRequiredShare: {
      min: 0.5,
      citation: { docId: "fju-ai-micro-114", locator: "第四條", quote: "至少有1/2比例之學分數不得為學生主系、所、雙主修學系及輔系之必修學分" },
    },
    apply: {
      text: "依學校公告的時程報名：在學生資訊入口網的「跨領域學習申請系統」填申請表，連同歷年成績單正本交到利瑪竇大樓 LM210，並上網登錄申請資料。名額 30 名，大學部學生或研究生都可以申請（以具資訊背景的 3、4 年級或研究生為佳）；隨班附讀、不另收費。",
      citation: { docId: "fju-ai-micro-114", locator: "申請須知", quote: "申請資料請繳交至利瑪竇大樓 LM210 室" },
    },
  },
  ecProgram(112),
  ecProgram(114),
  ecProgram(115),
];
