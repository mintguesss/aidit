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
 * provenance 一律是 draft：抄錄與課號對照還沒經人工校對鎖版，畫面上要照實標示。
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

export const FJU_EXTRA_PACKS: unknown[] = [
  {
    id: "fju-ph-double-major-112",
    school: "fju",
    kind: "double-major",
    dept: "PH",
    title: "物理學系雙主修（以光電物理組 110～112 學年度入學生必修科目表為準）",
    admissionYear: 112,
    version: "draft-1",
    provenance: "draft",
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
        match: {
          type: "courseList",
          codes: [
            "02391", "02392", "20538", "14561", "14562", "18630", "09201", "10428", "02532", "02533",
            "32411", "32412", "32197", "17841", "02287", "32413", "32414", "30403", "01751", "02766",
            "30277", "31379", "21639", "01404", "31414", "01403", "14150", "01947",
          ],
        },
        names: {
          "02391": "微積分(一)", "02392": "微積分(二)", "20538": "微積分-英", "14561": "普通物理(一)",
          "14562": "普通物理(二)", "18630": "程式設計(一)", "09201": "電磁學(一)", "10428": "電磁學(二)",
          "02532": "電子學(一)", "02533": "電子學(二)", "32197": "普通化學(一)", "17841": "普通化學(二)",
          "02287": "普通物理實驗", "01751": "近代物理", "02766": "線性代數", "21639": "量子物理(一)",
          "01404": "光學", "31414": "幾何光學與光學設計", "01403": "光電子學", "14150": "光電實驗", "01947": "書報討論",
        },
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
    admissionYear: 109,
    version: "draft-1",
    provenance: "draft",
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
    version: "draft-1",
    provenance: "draft",
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
];
