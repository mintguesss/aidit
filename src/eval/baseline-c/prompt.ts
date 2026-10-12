import { z } from "zod/v4";
import type { CourseRecord, StudentRecord } from "@/lib/types";

/**
 * 基準 C：把整份規章與成績單一次交給模型，請它直接做畢業學分審查。
 *
 * 這是「學生把成績單和規劃表貼給聊天機器人問」的情境。設計上要讓對照組**公平**：
 *   - 給它的原文跟我們引文回查比對的是同一份語料，成績單欄位也跟引擎看到的一樣
 *     （課號、學分、選別、開課單位、通識領域、是否學年課）
 *   - 明講不確定可以轉人工，給它跟我們一樣的退路
 *   - 只給原文，**不給任何我們算出來的東西**（類別歸屬、學分小計、待確認事項）。
 *     本檔的函式因此只接受成績單與原文，拿不到審查結果
 *   - 類別名稱照規則包給，只是為了讓兩邊的答案能逐類比對；名稱本身在規劃表上就有
 */

export const zBaselineAnswer = z.object({
  categories: z.array(
    z.object({
      name: z.string(),
      /** 這一類已採計的學分；不確定填 null */
      earned: z.number().nullable(),
      /** 這一類還差的學分；不確定填 null */
      unmet: z.number().nullable(),
      needsReview: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
  totalUnmet: z.number().nullable(),
  /** 通識還沒修足的領域；不確定填 null */
  missingGenEdDomains: z.array(z.string()).nullable(),
  canGraduate: z.enum(["yes", "no", "needs-review"]),
  holds: z.array(z.object({ item: z.string(), reason: z.string() })),
  citations: z.array(
    z.object({
      claim: z.string(),
      docId: z.string(),
      /** 原文逐字引句 */
      quote: z.string(),
    }),
  ),
});
export type BaselineAnswer = z.infer<typeof zBaselineAnswer>;

export type SourceDoc = { id: string; title: string; text: string };

export const BASELINE_SYSTEM = [
  "你是大學的畢業學分審查助理。根據使用者提供的規章原文與成績單，判斷這位學生的畢業學分進度。",
  "",
  "規則：",
  "1. 只能依據提供的文件判斷，不得使用文件以外的知識或一般大學的慣例。",
  "2. 依指定的類別逐類回報：已採計學分（earned）與還差學分（unmet）。",
  "3. 某一類無法確定時，earned 與 unmet 填 null、needsReview 填 true，並在 reason 說明原因。",
  "   不確定時轉人工確認，比給出錯誤的數字好。",
  "4. totalUnmet 是各類還差學分的合計；有任何一類無法確定就填 null。",
  "5. missingGenEdDomains：通識還沒修足的領域名稱，照文件寫法；都修足了填空陣列。",
  "6. canGraduate：yes＝所有畢業條件都已確定滿足；no＝確定還不能畢業；needs-review＝有條件需要人工確認。",
  "7. holds：列出需要人工確認的項目與原因。",
  "8. citations：每個關鍵判斷附上依據，docId 用文件標頭的代號，quote 必須是原文逐字摘錄。",
].join("\n");

/** PDF 抽出的文字有大量對齊用的空白；壓成一個，不刪任何字 */
export function compactText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t　]+/g, " ").trim())
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n");
}

const SELECT: Record<string, string> = { required: "必修", elective: "選修", general: "通識" };
const TERM: Record<string, string> = { "1": "上", "2": "下", summer: "暑修" };
const STATUS: Record<string, string> = {
  passed: "及格",
  failed: "不及格",
  in_progress: "修課中",
  waived: "抵免",
  withdrawn: "停修",
};

function courseLine(c: CourseRecord): string {
  return [
    `${c.year}${TERM[String(c.term)] ?? c.term}`,
    c.code,
    c.name,
    `${c.credits}學分`,
    SELECT[c.selectType] ?? c.selectType,
    STATUS[c.status] ?? c.status,
    c.offeringDept ? `開課單位 ${c.offeringDept}` : "",
    c.offeringCollege ? `開課學院 ${c.offeringCollege}` : "",
    c.generalDomain ? `通識領域 ${c.generalDomain}` : "",
    c.yearLong ? "學年課" : "",
  ]
    .filter(Boolean)
    .join("｜");
}

/** 給模型看的成績單（每門課一行）。評分時拿它核對模型引用成績單的句子 */
export function transcriptText(record: StudentRecord): string {
  return record.courses.map(courseLine).join("\n");
}

export function buildBaselineUser(
  record: StudentRecord,
  through: string,
  categoryNames: string[],
  docs: SourceDoc[],
): string {
  const s = record.student;
  return [
    "# 學生",
    `入學學年 ${s.admissionYear}，${s.program === "day" ? "日間部" : "進修部"}，系所代號 ${s.dept}。成績單截至 ${through} 學期。`,
    "",
    "# 成績單",
    "（學年學期｜課號｜課名｜學分｜選別｜狀態｜開課單位｜開課學院｜通識領域｜是否學年課）",
    transcriptText(record),
    "",
    "# 請依下列類別回報（名稱照抄）",
    ...categoryNames.map((n) => `- ${n}`),
    "",
    "# 規章原文",
    ...docs.flatMap((d) => [``, `## 【${d.id}】${d.title}`, compactText(d.text)]),
  ].join("\n");
}

/** 沒有金鑰或沒加 --live 時的替身：全部轉人工。只用來把流程跑通，數字不代表模型 */
export function offlineBaselineAnswer(categoryNames: string[]): BaselineAnswer {
  return {
    categories: categoryNames.map((name) => ({ name, earned: null, unmet: null, needsReview: true, reason: "離線替身" })),
    totalUnmet: null,
    missingGenEdDomains: null,
    canGraduate: "needs-review",
    holds: [],
    citations: [],
  };
}
