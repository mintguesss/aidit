import { PERIOD_TABLE, PERIOD_TIMES } from "./periods";
import { FJU_PERIODS, FJU_PERIOD_TABLE } from "./periods-fju";
import { DEFAULT_SCHOOL } from "@/lib/schools";

/**
 * 各校的節次方案：內部整數節次 → 給人看的名稱與鐘點。
 *
 * 系統內部一律用整數節次運算（衝堂判定是整數集合交集）。但顯示時不能直接印整數：
 * 輔大的內部第 6 節是 D5、鐘點也跟合成資料不同。週課表、課表匯出、時段文字都要經過這裡。
 *
 * 時間錯了比沒有時間更糟 —— 匯出的行事曆會用這裡的鐘點，所以出處（source、asOf）
 * 一併帶著，畫面與匯出檔都要寫出來。
 */

export type PeriodRow = { index: number; label: string; start: string; end: string };

export type PeriodScheme = {
  school: string;
  source: string;
  asOf: string;
  rows: PeriodRow[];
  /** 週課表預設顯示到哪一節（內部編號）；排到更晚的課才往下延伸 */
  defaultLast: number;
};

const DEMO: PeriodScheme = {
  school: "demo",
  source: PERIOD_TABLE.source,
  asOf: PERIOD_TABLE.asOf,
  rows: PERIOD_TIMES.map((p) => ({ index: p.period, label: String(p.period), start: p.start, end: p.end })),
  defaultLast: 8,
};

const FJU: PeriodScheme = {
  school: "fju",
  source: FJU_PERIOD_TABLE.source,
  asOf: FJU_PERIOD_TABLE.asOf,
  rows: FJU_PERIODS.map((p) => ({ index: p.index, label: p.code, start: p.start, end: p.end })),
  // D8（內部 9）：輔大日間部的最後一節
  defaultLast: 9,
};

const SCHEMES: Record<string, PeriodScheme> = { demo: DEMO, fju: FJU };

export function periodScheme(school: string = DEFAULT_SCHOOL): PeriodScheme {
  return SCHEMES[school] ?? DEMO;
}

export function periodRow(scheme: PeriodScheme, index: number): PeriodRow | undefined {
  return scheme.rows.find((r) => r.index === index);
}

/** 給人看的節次名稱；方案裡沒有這一節時退回整數，不猜 */
export function periodLabel(scheme: PeriodScheme, index: number): string {
  return periodRow(scheme, index)?.label ?? String(index);
}
