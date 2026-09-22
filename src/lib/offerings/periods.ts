/**
 * 節次與時間對照。
 *
 * 這是校方作息，不是求解器邏輯，所以放在開課資料這一側 ——
 * 換一所學校只要換這張表，求解器一行都不用改。
 *
 * **資料相依**：本表目前是合成資料。真實開課資料進來時，這張表必須一併更新，
 * 否則課表上的時間會是對的格式、錯的內容 —— 那比沒有時間更糟。
 * `PERIOD_TABLE` 的 `source` 與 `asOf` 會顯示在週課表下方，
 * 讓看的人知道時間是哪一版、什麼時候的。更新時兩個欄位都要改。
 */

export const PERIOD_TABLE = {
  source: "合成資料（日間部 14 節作息）",
  asOf: "2026-09-10",
} as const;
export type PeriodTime = { period: number; start: string; end: string };

export const PERIOD_TIMES: PeriodTime[] = [
  { period: 1, start: "08:10", end: "09:00" },
  { period: 2, start: "09:10", end: "10:00" },
  { period: 3, start: "10:20", end: "11:10" },
  { period: 4, start: "11:20", end: "12:10" },
  { period: 5, start: "13:20", end: "14:10" },
  { period: 6, start: "14:20", end: "15:10" },
  { period: 7, start: "15:30", end: "16:20" },
  { period: 8, start: "16:30", end: "17:20" },
  { period: 9, start: "17:30", end: "18:20" },
  { period: 10, start: "18:30", end: "19:20" },
  { period: 11, start: "19:25", end: "20:15" },
  { period: 12, start: "20:20", end: "21:10" },
  { period: 13, start: "21:15", end: "22:05" },
  { period: 14, start: "22:10", end: "23:00" },
];

const BY_PERIOD = new Map(PERIOD_TIMES.map((p) => [p.period, p]));

export function periodTime(period: number): PeriodTime | undefined {
  return BY_PERIOD.get(period);
}

/** 「三 3-4」→「10:20–12:10」；無法對照時回 undefined，不猜 */
export function spanOf(periods: number[]): string | undefined {
  if (periods.length === 0) return undefined;
  const sorted = [...periods].sort((a, b) => a - b);
  const a = periodTime(sorted[0]!);
  const b = periodTime(sorted[sorted.length - 1]!);
  if (!a || !b) return undefined;
  return `${a.start}–${b.end}`;
}
