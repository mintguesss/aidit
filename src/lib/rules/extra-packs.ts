import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";

/**
 * 額外修業規定：輔系、雙主修、學分學程。
 *
 * 這些與主修規劃表是**不同的規定**，所以另外一套資料，不塞進 RulePack。
 * 形狀比主修簡單得多：一組應修項目（指定科目清單或某系開設之科目），各有學分數，
 * 加總等於該項目的最低應修學分。
 *
 * 與主修規劃表一樣的三件事，一件都不能少：
 *   1. 每一條規定都要有 citation，且 quote 必須能在 corpus 回查；
 *   2. `provenance` 誠實標示（本專案目前全是 synthetic）；
 *   3. 沒有收錄的項目就是沒有 —— 不以「一般大學的作法」補上去。
 */

const zCite = z.object({
  docId: z.string(),
  locator: z.string(),
  quote: z.string().min(4),
});

const zRequirement = z.object({
  id: z.string(),
  label: z.string(),
  credits: z.number().int().positive(),
  match: z.union([
    z.object({ type: z.literal("courseList"), codes: z.array(z.string()).min(1) }),
    z.object({ type: z.literal("deptElective"), dept: z.string() }),
  ]),
  citation: zCite,
});

const zExtraPack = z.object({
  id: z.string(),
  kind: z.enum(["minor", "double-major", "cert-program"]),
  /** 輔系／雙主修：系所代碼。學分學程留空 */
  dept: z.string().optional(),
  /** 學分學程：學程名稱。輔系／雙主修留空 */
  program: z.string().optional(),
  title: z.string(),
  admissionYear: z.number().int(),
  version: z.string(),
  provenance: z.enum(["approved", "draft", "synthetic"]),
  minCredits: z.number().int().positive(),
  document: z.object({ id: z.string(), title: z.string(), publishedAt: z.string(), corpusFile: z.string() }),
  requirements: z.array(zRequirement).min(1),
  /** 與原學系的重複採計規定，畫面上要一併說明 */
  overlapPolicy: z.string(),
  overlapCitation: zCite,
});

export type ExtraPack = z.infer<typeof zExtraPack>;
export type ExtraRequirement = z.infer<typeof zRequirement>;

const FN_DOC = {
  id: "plan-fn-111",
  title: "111 學年度財務金融學系課程規劃表",
  publishedAt: "2023-06-20",
  corpusFile: "plan-fn-111.txt",
};

const INFOSEC_DOC = {
  id: "program-infosec",
  title: "資訊安全學分學程修習要點",
  publishedAt: "2023-08-01",
  corpusFile: "program-infosec.txt",
};

const RAW: ExtraPack[] = [
  {
    id: "minor-fn-111",
    kind: "minor",
    dept: "FN",
    title: "財務金融學系輔系（111 學年度）",
    admissionYear: 111,
    version: "1.0",
    provenance: "synthetic",
    minCredits: 20,
    document: FN_DOC,
    requirements: [
      {
        id: "core",
        label: "輔系核心必修",
        credits: 9,
        match: { type: "courseList", codes: ["FN3001", "FN3002", "FN3005"] },
        citation: {
          docId: "plan-fn-111",
          locator: "第 2 頁第二點",
          quote: "輔系核心必修科目為投資學、財務管理、貨幣銀行學，共九學分，不得以其他科目抵充。",
        },
      },
      {
        id: "elective",
        label: "輔系選修",
        credits: 11,
        match: { type: "deptElective", dept: "FN" },
        citation: {
          docId: "plan-fn-111",
          locator: "第 2 頁第三點",
          quote: "輔系選修應修滿十一學分，以本系開設之科目為限。",
        },
      },
    ],
    overlapPolicy:
      "原學系已修並及格之財金系科目得計入輔系；同一科目不得同時計入原學系必修與輔系核心必修。",
    overlapCitation: {
      docId: "plan-fn-111",
      locator: "第 2 頁第四點",
      quote: "同一科目不得同時計入原學系必修與輔系核心必修。",
    },
  },
  {
    id: "double-fn-111",
    kind: "double-major",
    dept: "FN",
    title: "財務金融學系雙主修（111 學年度）",
    admissionYear: 111,
    version: "1.0",
    provenance: "synthetic",
    minCredits: 48,
    document: FN_DOC,
    requirements: [
      {
        id: "required",
        label: "財金系專業必修",
        credits: 30,
        match: {
          type: "courseList",
          codes: [
            "FN2001",
            "FN2002",
            "FN3001",
            "FN3002",
            "FN3005",
            "FN3006",
            "FN3007",
            "FN4001",
            "FN4002",
            "FN4003",
          ],
        },
        citation: {
          docId: "plan-fn-111",
          locator: "第 1 頁第一點",
          quote: "本系專業必修科目共三十學分",
        },
      },
      {
        id: "elective",
        label: "財金系專業選修",
        credits: 18,
        match: { type: "deptElective", dept: "FN" },
        citation: {
          docId: "plan-fn-111",
          locator: "第 1 頁第二點",
          quote: "本系專業選修應修滿十八學分，以本系開設之科目為限。",
        },
      },
    ],
    overlapPolicy:
      "雙主修學生之原學系畢業條件仍須完全滿足，兩系條件均達成始得授予雙學位；共同開設之科目僅得擇一採計。",
    overlapCitation: {
      docId: "plan-fn-111",
      locator: "第 3 頁第二點",
      quote: "雙主修學生之原學系畢業條件仍應完全滿足，兩系條件均達成始得授予雙學位。",
    },
  },
  {
    id: "program-infosec-111",
    kind: "cert-program",
    program: "資訊安全",
    title: "資訊安全學分學程（111 學年度起適用）",
    admissionYear: 111,
    version: "1.0",
    provenance: "synthetic",
    minCredits: 21,
    document: INFOSEC_DOC,
    requirements: [
      {
        id: "core",
        label: "核心必修",
        credits: 9,
        match: { type: "courseList", codes: ["IM3006", "IM3009", "IM4051"] },
        citation: {
          docId: "program-infosec",
          locator: "第二點",
          quote: "核心必修科目為資訊安全概論、密碼學基礎、網路安全實務，共九學分。",
        },
      },
      {
        id: "elective",
        label: "學程選修",
        credits: 12,
        match: {
          type: "courseList",
          codes: ["IM4013", "IM4017", "IM4018", "IM4021", "IM4045"],
        },
        citation: {
          docId: "program-infosec",
          locator: "第三點",
          quote: "學程選修應修滿十二學分，科目以本要點附表所列者為限",
        },
      },
    ],
    overlapPolicy: "原學系已修並及格之科目凡屬本要點所列者均可計入，不受原學系採計類別影響。",
    overlapCitation: {
      docId: "program-infosec",
      locator: "第四點",
      quote: "凡屬本要點所列者，得計入本學程學分，",
    },
  },
];

let cache: ExtraPack[] | null = null;

export function loadExtraPacks(): ExtraPack[] {
  if (cache) return cache;
  cache = RAW.map((p) => {
    const parsed = zExtraPack.safeParse(p);
    if (!parsed.success) {
      throw new Error(`額外修業規定 ${p.id} 未通過 schema 驗證：${parsed.error.message}`);
    }
    return parsed.data;
  });
  return cache;
}

/** 找不到就回 undefined —— 沒有收錄的規定就是沒有 */
export function findExtraPack(
  kind: ExtraPack["kind"],
  key: { dept?: string; program?: string },
): ExtraPack | undefined {
  return loadExtraPacks().find(
    (p) =>
      p.kind === kind &&
      (kind === "cert-program"
        ? Boolean(key.program) && Boolean(p.program) && normalise(p.program!) === normalise(key.program!)
        : p.dept === key.dept),
  );
}

const normalise = (s: string) => s.replace(/\s|學程|學分學程/g, "");

const CORPUS_DIR = join(process.cwd(), "src", "lib", "rules", "corpus");

/** 額外規定的原文，供 /api/corpus 與引用回查使用 */
export function extraCorpus(): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of loadExtraPacks()) {
    const path = join(CORPUS_DIR, p.document.corpusFile);
    if (existsSync(path)) map.set(p.document.id, readFileSync(path, "utf8"));
  }
  return map;
}
