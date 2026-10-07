import { z } from "zod/v4";

/**
 * 規則包 schema（docs/SPEC.md §5）。
 *
 * 規則包是離線抽取 + 人工校對後的產物，執行期只做 zod 驗證與查表，
 * 不在執行期解析 PDF、也不在執行期問 LLM。
 */

export const zCitation = z.object({
  docId: z.string().min(1),
  locator: z.string().min(1),
  /** citation.verify 的唯一依據；沒有 quote 等同於沒有依據 */
  quote: z.string().min(2).optional(),
});
export type RuleCitation = z.infer<typeof zCitation>;

export const zDocument = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().optional(),
  publishedAt: z.string().optional(),
  /** 原文語料檔名（相對於 rules/corpus/），citation.verify 據此載入 */
  corpusFile: z.string().optional(),
});

// ------------------------------------------------------------------ match

const zMatch = z.discriminatedUnion("type", [
  /** 指定科目表：課號完全比對（含舊課號對照） */
  z.object({
    type: z.literal("courseList"),
    codes: z.array(z.string()).min(1),
    /**
     * 不排他：修滿這一類之後多修的，可以改算進其他類別（通常是選修）。
     * 輔大物理系光電組的「群組必修至少 3 學分」：從一串課裡挑，多修的不該白修。
     * 沒設就排他（列在科目表上的課只能算這一類）
     */
    shared: z.boolean().optional(),
  }),
  /**
   * 指定科目表，但規劃表**只列課名、沒有課號** —— 例如輔大的國文、外國語文是分組上課，
   * 各組課號不同，規劃表上只寫「國文」。比對時去掉空白後完全相等，不做模糊比對：
   * 課名猜錯就會把學分算進錯的類別，寧可比不到（落到待確認或未修）也不要猜。
   * 成績單上的實際課名要在人工校對時確認並列全。
   */
  z
    .object({
      type: z.literal("courseNames"),
      names: z.array(z.string().min(1)).default([]),
      /**
       * 課名開頭。成績單把級別寫在括號裡（「外國語文(中級英文)」），規劃表只寫「外國語文」。
       * 比對規則見 lib/courses/names.ts
       */
      prefixes: z.array(z.string().min(1)).optional(),
    })
    .refine((m) => m.names.length + (m.prefixes?.length ?? 0) > 0, { message: "courseNames 至少要有一個課名或開頭" }),
  /** 依選別欄位歸屬，如通識 */
  z.object({ type: z.literal("selectType"), value: z.enum(["required", "elective", "general"]) }),
  /** 本系（或指定系）開設之選修 */
  z.object({
    type: z.literal("deptElective"),
    dept: z.string().min(1),
    /**
     * 本系開、但規定不算進這一類的課（課名，去空白後完全比對）。
     * 輔大 111 規劃表把「組織學習與社會探究」等兩門畫在系選修框線外：系上開的課，
     * 卻不算那 10 學分系專選，只能算其他選修。
     * 用課名而不用課號：規劃表上 19664 同時印給了兩門課，用課號會連另一門一起排除。
     */
    excludeNames: z.array(z.string().min(1)).optional(),
  }),
  /** 自由選修：任何及格學分皆可，作為承接類別 */
  z.object({ type: z.literal("anyPassed") }),
]);
export type RuleMatch = z.infer<typeof zMatch>;

// ---------------------------------------------------------------- subRule

const zSubRule = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("domainCoverage"),
    id: z.string(),
    name: z.string(),
    domains: z.array(z.string()).min(1),
    /** 每個領域至少修幾門 */
    minPerDomain: z.number().int().positive(),
    /**
     * 每個領域至少修幾學分。有設就以學分判定（取代門數）—— 輔大是各領域 4 學分，
     * 修了一門 2 學分的課，門數算滿足、學分卻還差 2。
     */
    minCreditsPerDomain: z.number().int().positive().optional(),
    citation: zCitation,
  }),
  /**
   * 這一類採計的課裡，至少要有幾學分是指定系所開的選修。
   *
   * 輔大資管 111：「選修課程中包含本系專業選修課程至少 10學分」。以前建成「系專選 10」＋「其他選修 22」
   * 兩個切開的類別 —— 課不能拆，修了 2＋3＋3＋3＋3 ＝ 14 學分本系選修卻湊不出剛好 10，
   * 系統說「系專選還差 2」，其實早就滿足（TODO H9）。「包含」是分項條件，不是另一個類別
   */
  z.object({
    type: z.literal("minDeptCredits"),
    id: z.string(),
    name: z.string(),
    dept: z.string().min(1),
    minCredits: z.number().int().positive(),
    citation: zCitation,
  }),
  z.object({
    type: z.literal("minCoursesFromList"),
    id: z.string(),
    name: z.string(),
    codes: z.array(z.string()).min(1),
    minCourses: z.number().int().positive(),
    citation: zCitation,
  }),
]);
export type RuleSubRule = z.infer<typeof zSubRule>;

// ------------------------------------------------------------- ambiguity

/**
 * trigger 命中時，該筆修課「整個移出」指派問題，並產生 HoldItem。
 * 不確定是資料驅動的，不是 LLM 臨時判斷 —— 這是本系統零錯答主張的地基。
 */
const zTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("courseFromOtherCollege") }),
  z.object({ type: z.literal("courseFromOtherDept") }),
  z.object({ type: z.literal("waiverWithoutMapping") }),
  z.object({ type: z.literal("retiredCourseCode") }),
  /** 通識領域是這一個的課（例：輔大 114 學年起新增的「永續素養」，舊生採計方式另有公告） */
  z.object({ type: z.literal("generalDomain"), domain: z.string().min(1) }),
]);
export type RuleTrigger = z.infer<typeof zTrigger>;

const zAmbiguity = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  trigger: zTrigger,
  citation: zCitation,
  contact: z.string().min(1),
  /** 已檢索過哪些來源 —— HoldItem 的 body 需要，缺了會像偷懶 */
  searchedSources: z.array(z.string()).min(1),
  /**
   * thisCategory —— 待確認項解消後，該課確定落在本類別
   * undetermined —— 連歸屬類別本身都無法判定（如抵免課號查無對照）
   * 兩者都會把該筆修課整個移出指派問題，差別只在 HoldItem 如何描述影響範圍。
   */
  affects: z.enum(["thisCategory", "undetermined"]).default("thisCategory"),
});
export type RuleAmbiguity = z.infer<typeof zAmbiguity>;

// ------------------------------------------------------------- category

export const zCategory = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 修業尺上的短名，避免長標籤把橫條擠爆 */
  shortName: z.string().min(1),
  credits: z.number().int().nonnegative(),
  match: zMatch,
  subRules: z.array(zSubRule).default([]),
  ambiguities: z.array(zAmbiguity).default([]),
  citation: zCitation,
  /** 指派決勝用的顯示順序，同時決定修業尺左右排序 */
  order: z.number().int(),
});
export type RuleCategory = z.infer<typeof zCategory>;

// ------------------------------------------------------------ 畢業條件

const zGraduationCheck = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * evidence   —— 依 StudentRecord.graduationEvidence 判定
   * deptDefined —— 規劃表僅記載「各系自訂」，須另尋公告；找不到就是 hold
   * passedCourse —— 成績單上有這門課就算（輔大的全民國防教育軍事訓練：0 學分，但成績單上有）。
   *                 課名去空白後完全比對；找不到一律 hold，不判未修 —— 可能只是課名寫法不同
   */
  rule: z.enum(["evidence", "deptDefined", "passedCourse"]),
  /** rule = passedCourse：成績單上的課名，任一個相符即可 */
  courseNames: z.array(z.string().min(1)).optional(),
  /** rule = passedCourse：至少要修過幾個學期（體育是 4），預設 1 */
  minTerms: z.number().int().positive().optional(),
  /**
   * 屬於哪個學分類別（選填）。0 學分的必修 —— 輔大的體育 —— 不影響學分數，但規劃表把它列在
   * 全人核心裡。記下歸屬，顯示時才不會讓人以為那一類漏了它。
   */
  category: z.string().optional(),
  citation: zCitation,
  contact: z.string().min(1),
  searchedSources: z.array(z.string()).default([]),
  /**
   * rule = deptDefined 判斷不了時，待確認事項寫的原因。沒填就用「規劃表記載各系自訂」的制式說法 ——
   * 但不是每一則都是那種情況（輔大物理系是兩份文件寫的不一樣），原因寫錯等於誤導學生去問錯的事
   */
  holdDetail: z.string().min(1).optional(),
});
export type RuleGraduationCheck = z.infer<typeof zGraduationCheck>;

// ------------------------------------------------------------- rulePack

export const zOverflowPolicy = z.object({
  /** 超修是否計入「修得總學分」 */
  countsToTotal: z.boolean(),
  /** 一律為 false：超修不得流用補其他類別的 unmet */
  transferable: z.literal(false),
  citation: zCitation,
});

export const zRulePack = z
  .object({
    id: z.string().min(1),
    /** 學校代號（lib/schools.ts）。未填為 "demo"，即合成資料 */
    school: z.string().min(1).default("demo"),
    dept: z.string().min(1),
    /** 組別（見 Student.group）。沒分組的系不填 */
    group: z.string().min(1).optional(),
    admissionYear: z.number().int(),
    program: z.enum(["day", "night"]),
    version: z.string().min(1),
    approvedAt: z.string().min(1),
    /**
     * approved  —— 已人工校對並鎖版
     * draft     —— 抽取完成但未校對，不得用於正式判定
     * synthetic —— 合成語料，僅供 demo 與評測
     */
    provenance: z.enum(["approved", "draft", "synthetic"]),
    approvedBy: z.string().nullable().default(null),
    /** 鎖版用：規則包正規化後的 content hash */
    contentHash: z.string().optional(),
    minCredits: z.number().int().positive(),
    /** 畢業最低學分的原文出處。合成資料沒有；真實規則包要附，校對時才有原文可對 */
    minCreditsCitation: zCitation.optional(),
    /** 本系所屬學院，判定跨院選修用 */
    college: z.string().min(1),
    documents: z.array(zDocument).min(1),
    categories: z.array(zCategory).min(1),
    overflowPolicy: z.record(z.string(), zOverflowPolicy),
    graduationChecks: z.array(zGraduationCheck).default([]),
    /**
     * 全學年課程：上、下學期**共用同一個課號**，各算一半學分（輔大的微積分 02390
     * 就是上 3、下 3）。去重時以「課號＋學期」為單位，否則下學期那一筆會被當成
     * 重修丟掉，算出假的未修。沒列在這裡的課號，同課號一律視為重補修。
     */
    yearLongCourses: z.array(z.string()).default([]),
    termLimits: z.object({
      maxCredits: z.number().int().positive(),
      minCredits: z.number().int().positive(),
      /**
       * 依學年調整。輔大選課辦法第十一條：一至三年級下限 12、第四學年下限 9；
       * 上限 25，應屆畢業生得超修至 32。fromYear 起（含）套用，後面的蓋過前面的。
       * 實際套用由 lib/rules/term-limits.ts 的 termLimitsFor() 計算，不要直接讀上面兩欄。
       */
      byStudyYear: z
        .array(
          z.object({
            fromYear: z.number().int().positive(),
            maxCredits: z.number().int().positive().optional(),
            minCredits: z.number().int().positive().optional(),
          }),
        )
        .default([]),
      /** 上下限是排課的硬限制，要能在校對頁對照原文 */
      citations: z.array(zCitation).default([]),
    }),
  })
  .superRefine((pack, ctx) => {
    // docs/BACKEND.md §2 自動驗證：類別學分加總必須等於畢業最低學分
    const sum = pack.categories.reduce((a, c) => a + c.credits, 0);
    if (sum !== pack.minCredits) {
      ctx.addIssue({
        code: "custom",
        message: `類別學分加總 ${sum} 與 minCredits ${pack.minCredits} 不符`,
        path: ["categories"],
      });
    }
    // 類別 id 不得重複
    const ids = pack.categories.map((c) => c.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "類別 id 重複", path: ["categories"] });
    }
    // 承接類別（anyPassed）至多一個，否則指派問題沒有明確的溢出去處
    const anyPassed = pack.categories.filter((c) => c.match.type === "anyPassed");
    if (anyPassed.length > 1) {
      ctx.addIssue({
        code: "custom",
        message: "至多只能有一個 anyPassed 承接類別",
        path: ["categories"],
      });
    }
    // citation 的 docId 必須存在於 documents
    const docIds = new Set(pack.documents.map((d) => d.id));
    const check = (c: RuleCitation, path: (string | number)[]) => {
      if (!docIds.has(c.docId)) {
        ctx.addIssue({
          code: "custom",
          message: `citation.docId "${c.docId}" 不在 documents 中`,
          path,
        });
      }
    };
    pack.categories.forEach((cat, i) => {
      check(cat.citation, ["categories", i, "citation"]);
      cat.subRules.forEach((s, j) => check(s.citation, ["categories", i, "subRules", j]));
      cat.ambiguities.forEach((a, j) => check(a.citation, ["categories", i, "ambiguities", j]));
    });
    pack.graduationChecks.forEach((g, i) => {
      check(g.citation, ["graduationChecks", i]);
      if (g.rule === "passedCourse" && !g.courseNames?.length) {
        ctx.addIssue({ code: "custom", message: `畢業條件 ${g.id} 是 passedCourse，但沒有 courseNames`, path: ["graduationChecks", i, "courseNames"] });
      }
      if (g.category && !pack.categories.some((c) => c.id === g.category)) {
        ctx.addIssue({ code: "custom", message: `畢業條件 ${g.id} 的 category "${g.category}" 不是任何學分類別`, path: ["graduationChecks", i, "category"] });
      }
    });
    pack.termLimits.citations.forEach((c, i) => check(c, ["termLimits", "citations", i]));
    if (pack.minCreditsCitation) check(pack.minCreditsCitation, ["minCreditsCitation"]);
    Object.entries(pack.overflowPolicy).forEach(([k, v]) => check(v.citation, ["overflowPolicy", k]));
  });

export type RulePack = z.infer<typeof zRulePack>;

/** 課號格式依學校而異，集中在 lib/courses/code.ts */
export { COURSE_CODE_RE } from "@/lib/courses/code";
