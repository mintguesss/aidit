/**
 * 輔仁大學節次代號與上課時間。
 *
 * 出處：輔仁大學教務處〈教室、節次、週次代號說明〉，原文照錄於下方 FJU_PERIODS。
 * https://docsacademic.fju.edu.tw/about%20course/教室、節次、週次代號說明.pdf
 *
 * **映射到系統的整數節次。** 求解器的衝堂判定是整數集合交集，對話層的時段語意
 * 也以整數區間定義（早上 1–4、下午 5–9、晚上 10–15，見 lib/chat/apply.ts）。
 * 輔大代碼照下表映射後，這些區間直接成立：
 *
 *   D0 → 0   特早節，07:10 開始
 *   D1–D4 → 1–4   早上
 *   DN → 5   特午節 12:40，落在「下午」的開頭
 *   D5–D8 → 6–9
 *   E0 → 10  第九節 17:40，「晚上」的開頭
 *   E1–E4 → 11–14
 *
 * 代價是**內部編號不等於輔大的節次名稱**：內部第 6 節是輔大的 D5。
 * 顯示給使用者時一律要用 label，不能直接印「第 6 節」—— 見 docs/TODO.md。
 *
 * 另有週次代號（S）單週、（D）雙週上課，系統的時段模型目前沒有這個概念：
 * 單雙週的課會被當成每週都上，衝堂判定會偏嚴（多擋），不會漏擋。
 */

export const FJU_PERIOD_TABLE = {
  source: "輔仁大學教務處〈教室、節次、週次代號說明〉",
  url: "https://docsacademic.fju.edu.tw/about%20course/%E6%95%99%E5%AE%A4%E3%80%81%E7%AF%80%E6%AC%A1%E3%80%81%E9%80%B1%E6%AC%A1%E4%BB%A3%E8%99%9F%E8%AA%AA%E6%98%8E.pdf",
  asOf: "2026-10-01",
} as const;

export type FjuPeriod = {
  /** 輔大節次代號 */
  code: string;
  /** 系統內部的整數節次 */
  index: number;
  /** 原文的節次名稱 */
  label: string;
  start: string;
  end: string;
};

export const FJU_PERIODS: readonly FjuPeriod[] = [
  { code: "D0", index: 0, label: "特早節", start: "07:10", end: "08:00" },
  { code: "D1", index: 1, label: "第一節", start: "08:10", end: "09:00" },
  { code: "D2", index: 2, label: "第二節", start: "09:10", end: "10:00" },
  { code: "D3", index: 3, label: "第三節", start: "10:10", end: "11:00" },
  { code: "D4", index: 4, label: "第四節", start: "11:10", end: "12:00" },
  { code: "DN", index: 5, label: "特午節", start: "12:40", end: "13:30" },
  { code: "D5", index: 6, label: "第五節", start: "13:40", end: "14:30" },
  { code: "D6", index: 7, label: "第六節", start: "14:40", end: "15:30" },
  { code: "D7", index: 8, label: "第七節", start: "15:40", end: "16:30" },
  { code: "D8", index: 9, label: "第八節", start: "16:40", end: "17:30" },
  { code: "E0", index: 10, label: "第九節", start: "17:40", end: "18:30" },
  { code: "E1", index: 11, label: "夜一節", start: "18:40", end: "19:30" },
  { code: "E2", index: 12, label: "夜二節", start: "19:35", end: "20:20" },
  { code: "E3", index: 13, label: "夜三節", start: "20:30", end: "21:20" },
  { code: "E4", index: 14, label: "夜四節", start: "21:25", end: "22:10" },
];

const BY_CODE = new Map(FJU_PERIODS.map((p) => [p.code, p]));
const BY_INDEX = new Map(FJU_PERIODS.map((p) => [p.index, p]));

/** 「D5」「dn」→ 內部整數節次；不是輔大代碼就回 undefined */
export function fjuPeriodIndex(code: string): number | undefined {
  return BY_CODE.get(code.trim().toUpperCase())?.index;
}

export function fjuPeriodByIndex(index: number): FjuPeriod | undefined {
  return BY_INDEX.get(index);
}
