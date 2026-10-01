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
  z.object({ type: z.literal("courseList"), codes: z.array(z.string()).min(1) }),
  /**
   * 指定科目表，但規劃表**只列課名、沒有課號** —— 例如輔大的國文、外國語文是分組上課，
   * 各組課號不同，規劃表上只寫「國文」。比對時去掉空白後完全相等，不做模糊比對：
   * 課名猜錯就會把學分算進錯的類別，寧可比不到（落到待確認或未修）也不要猜。
   * 成績單上的實際課名要在人工校對時確認並列全。
   */
  z.object({ type: z.literal("courseNames"), names: z.array(z.string().min(1)).min(1) }),
  /** 依選別欄位歸屬，如通識 */
  z.object({ type: z.literal("selectType"), value: z.enum(["required", "elective", "general"]) }),
  /** 本系（或指定系）開設之選修 */
  z.object({ type: z.literal("deptElective"), dept: z.string().min(1) }),
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
   */
  rule: z.enum(["evidence", "deptDefined"]),
  citation: zCitation,
  contact: z.string().min(1),
  searchedSources: z.array(z.string()).default([]),
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
    dept: z.string().min(1),
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
    pack.graduationChecks.forEach((g, i) => check(g.citation, ["graduationChecks", i]));
    Object.entries(pack.overflowPolicy).forEach(([k, v]) => check(v.citation, ["overflowPolicy", k]));
  });

export type RulePack = z.infer<typeof zRulePack>;

/** 課號格式依學校而異，集中在 lib/courses/code.ts */
export { COURSE_CODE_RE } from "@/lib/courses/code";
