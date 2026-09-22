import type { TimeSlot } from "@/lib/types";

/**
 * 上課時段字串解析（BACKEND.md §4）。
 *
 * 節次本身已是離散整數，衝堂判定就是集合交集，不需要處理實際鐘點時間。
 * 解析失敗的課程要「標記」而不是丟棄 —— 它仍可被採計，只是不能參與衝堂判定。
 */

export type SlotParse = {
  slots: TimeSlot[];
  /** true 表示字串非空但無法解析；UI 須標示「時段未知」 */
  unknown: boolean;
  raw: string;
};

const DAY_MAP: Record<string, 1 | 2 | 3 | 4 | 5 | 6 | 7> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
};

/** 夜間節次代號 → 連續整數，讓衝堂判定維持單純的集合交集 */
const LETTER_PERIOD: Record<string, number> = { a: 11, b: 12, c: 13, d: 14, e: 15 };

const NO_CLASS_RE = /^(無上課時間|無|未定|不定時|另約時間|彈性時間|時間另訂)$/;

function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function normalizeSlotText(raw: string): string {
  return toHalfWidth(raw)
    .replace(/[　\s]+/g, " ")
    .replace(/[、；;]/g, "/")
    .replace(/[～~—–]/g, "-")
    .replace(/節|第/g, "")
    .replace(/星期|週|周/g, "")
    .trim();
}

/** 單一節次符號 → 整數；無法辨識回傳 null */
function toPeriod(tok: string): number | null {
  const t = tok.trim().toLowerCase();
  if (t === "") return null;
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 0 && n <= 20 ? n : null;
  }
  return LETTER_PERIOD[t] ?? null;
}

/**
 * 節次區段解析。
 *   "3-4"    → 3,4         兩端點視為區間
 *   "2-3-4"  → 2,3,4       三段以上視為列舉（區間解讀在 "2-4-6" 會多算，故不採用）
 *   "3-4,5"  → 3,4,5
 *   "A,B"    → 11,12
 */
function parsePeriods(spec: string): number[] | null {
  const out = new Set<number>();
  for (const chunk of spec.split(",")) {
    const parts = chunk.split("-").map((p) => p.trim()).filter((p) => p !== "");
    if (parts.length === 0) continue;
    if (parts.length === 2) {
      const a = toPeriod(parts[0]!);
      const b = toPeriod(parts[1]!);
      if (a === null || b === null) return null;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) out.add(i);
    } else {
      for (const p of parts) {
        const n = toPeriod(p);
        if (n === null) return null;
        out.add(n);
      }
    }
  }
  return out.size > 0 ? [...out].sort((x, y) => x - y) : null;
}

const SEGMENT_RE =
  /([一二三四五六日天]|mon|tue|wed|thu|fri|sat|sun|(?<!\d)[1-7](?=[ ]))[ ]*([0-9a-eA-E][0-9a-eA-E,\-]*)/gi;

export function parseSlots(raw: string): SlotParse {
  const text = normalizeSlotText(raw ?? "");
  if (text === "" || NO_CLASS_RE.test(text)) return { slots: [], unknown: false, raw };

  const slots: TimeSlot[] = [];
  let matched = false;

  for (const part of text.split("/")) {
    const chunk = part.trim();
    if (chunk === "") continue;

    SEGMENT_RE.lastIndex = 0;
    const covered = new Array<boolean>(chunk.length).fill(false);
    let m: RegExpExecArray | null;
    while ((m = SEGMENT_RE.exec(chunk)) !== null) {
      const day = DAY_MAP[m[1]!.toLowerCase()];
      const periods = parsePeriods(m[2]!);
      if (day === undefined || periods === null) continue;
      slots.push({ day, periods });
      for (let i = m.index; i < m.index + m[0]!.length; i++) covered[i] = true;
      matched = true;
    }

    // 未被任何 segment 覆蓋的字元只允許是空白或分隔符號。
    // 有殘餘就代表我們只看懂了一半 —— 寧可整筆標為未知，也不輸出片段時段，
    // 因為片段時段會讓衝堂判定「看起來有做」卻漏掉真正的衝突。
    const residue = [...chunk].filter((_, i) => !covered[i]).join("").replace(/[ ,\-]/g, "");
    if (residue !== "") return { slots: [], unknown: true, raw };
  }

  if (!matched) return { slots: [], unknown: true, raw };
  return { slots: mergeSlots(slots), unknown: false, raw };
}

/** 同一天的多個區段合併，方便衝堂判定 */
function mergeSlots(slots: TimeSlot[]): TimeSlot[] {
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

// -------------------------------------------------------------- 衝堂判定

export function clashes(a: TimeSlot[], b: TimeSlot[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x.day !== y.day) continue;
      if (x.periods.some((p) => y.periods.includes(p))) return true;
    }
  }
  return false;
}

const DAY_LABEL = ["", "一", "二", "三", "四", "五", "六", "日"];
const PERIOD_LABEL = (p: number) => (p >= 11 ? String.fromCharCode(65 + p - 11) : String(p));

/** 回寫成可讀字串，用於 UI 與選課建議表 */
export function formatSlots(slots: TimeSlot[], unknown = false): string {
  if (unknown) return "時段未知";
  if (slots.length === 0) return "無上課時間";
  return slots
    .map((s) => {
      const ps = s.periods;
      const contiguous = ps.every((p, i) => i === 0 || p === ps[i - 1]! + 1);
      const body =
        contiguous && ps.length > 1
          ? `${PERIOD_LABEL(ps[0]!)}-${PERIOD_LABEL(ps[ps.length - 1]!)}`
          : ps.map(PERIOD_LABEL).join(",");
      return `${DAY_LABEL[s.day]} ${body}`;
    })
    .join(" / ");
}

export function isEarlyMorning(slots: TimeSlot[]): boolean {
  return slots.some((s) => s.periods.includes(1));
}
