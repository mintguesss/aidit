import type { TimeSlot } from "@/lib/types";

/**
 * 時段字串測試語料（BACKEND.md §4 要求 500 筆全數通過）。
 *
 * 真實專案應蒐集 500 筆校務系統實際輸出當語料；本版以組合生成涵蓋
 * 已知的格式變異，並附上由**獨立規則**算出的預期結果（不呼叫 parser）。
 * 真實字串取得後，直接把它們追加到 EXTRA 即可。
 */

export type SlotCase = { input: string; expect: TimeSlot[] | "unknown" };

const DAY_FORMS: [string, TimeSlot["day"]][] = [
  ["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["日", 7],
  ["週一", 1], ["週三", 3], ["週五", 5],
  ["星期二", 2], ["星期四", 4], ["星期六", 6],
  ["1 ", 1], ["3 ", 3], ["5 ", 5],
  ["Mon", 1], ["Wed", 3], ["Fri", 5],
];

/** [字串, 節次集合]；節次由手寫規則列出，不經 parser */
const PERIOD_FORMS: [string, number[]][] = [
  ["1", [1]],
  ["5", [5]],
  ["3-4", [3, 4]],
  ["6-8", [6, 7, 8]],
  ["2-5", [2, 3, 4, 5]],
  ["3,4", [3, 4]],
  ["2,4,6", [2, 4, 6]],
  ["3-4,5", [3, 4, 5]],
  ["2-3-4", [2, 3, 4]],
  ["1,2,3", [1, 2, 3]],
  ["A", [11]],
  ["B", [12]],
  ["A,B", [11, 12]],
  ["A-C", [11, 12, 13]],
  ["7-9", [7, 8, 9]],
  ["8,9", [8, 9]],
];

const NO_CLASS = ["無上課時間", "未定", "另約時間", "彈性時間", "時間另訂", ""];

/** 全形轉換，模擬校務系統輸出的全形數字與標點 */
function toFullWidth(s: string): string {
  return s.replace(/[!-~]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
}

function merge(slots: TimeSlot[]): TimeSlot[] {
  const byDay = new Map<number, Set<number>>();
  for (const s of slots) {
    const set = byDay.get(s.day) ?? new Set<number>();
    for (const p of s.periods) set.add(p);
    byDay.set(s.day, set);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, set]) => ({ day: day as TimeSlot["day"], periods: [...set].sort((x, y) => x - y) }));
}

export function slotCorpus(): SlotCase[] {
  const cases: SlotCase[] = [];

  // 單一時段：所有 day × period 組合
  for (const [dayStr, day] of DAY_FORMS) {
    for (const [pStr, periods] of PERIOD_FORMS) {
      cases.push({ input: `${dayStr} ${pStr}`.replace(/\s+/g, " ").trim(), expect: [{ day, periods }] });
    }
  }

  // 兩段時段，三種分隔符號
  const seps = [" / ", "、", "；"];
  let i = 0;
  for (const [d1, day1] of DAY_FORMS.slice(0, 7)) {
    for (const [p1, per1] of PERIOD_FORMS.slice(0, 6)) {
      const [d2, day2] = DAY_FORMS[(i + 3) % 7]!;
      const [p2, per2] = PERIOD_FORMS[(i + 5) % PERIOD_FORMS.length]!;
      const sep = seps[i % seps.length]!;
      cases.push({
        input: `${d1} ${p1}${sep}${d2} ${p2}`,
        expect: merge([
          { day: day1, periods: per1 },
          { day: day2, periods: per2 },
        ]),
      });
      i++;
    }
  }

  // 全形變體
  for (const [dayStr, day] of DAY_FORMS.slice(0, 7)) {
    for (const [pStr, periods] of PERIOD_FORMS.slice(0, 10)) {
      cases.push({ input: `${dayStr}　${toFullWidth(pStr)}`, expect: [{ day, periods }] });
    }
  }

  // 含「節」「第」等贅字
  for (const [dayStr, day] of DAY_FORMS.slice(0, 10)) {
    for (const [pStr, periods] of PERIOD_FORMS.slice(0, 10)) {
      cases.push({ input: `${dayStr} 第${pStr}節`, expect: [{ day, periods }] });
    }
  }

  // 前後多餘空白與全形空白
  for (const [dayStr, day] of DAY_FORMS.slice(0, 7)) {
    for (const [pStr, periods] of PERIOD_FORMS.slice(0, 5)) {
      cases.push({ input: `  ${dayStr}　${pStr} `, expect: [{ day, periods }] });
    }
  }

  // 無上課時間
  for (const s of NO_CLASS) cases.push({ input: s, expect: [] });

  // 無法解析：必須標記為 unknown，不得丟棄也不得部分猜測
  for (const s of EXTRA_UNKNOWN) cases.push({ input: s, expect: "unknown" });

  return cases;
}

/** 已知無法解析的實務字串：仍可採計，但不參與衝堂判定 */
const EXTRA_UNKNOWN = [
  "密集課程 詳見系網",
  "遠距教學 非同步",
  "隔週上課 詳洽授課教師",
  "視實習單位安排",
  "TBA",
  "見課程大綱",
];
