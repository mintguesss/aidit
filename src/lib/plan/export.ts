import { periodScheme, periodRow, type PeriodScheme } from "@/lib/offerings/period-scheme";
import type { Plan } from "@/lib/types";

/**
 * 課表匯出。
 *
 * 純函式，沒有任何 I/O —— 檔案在瀏覽器端產生，課表本身不落地
 * （docs/DATA.md：課表不存，每次由審查結果＋偏好重算）。
 * 「匯出」正是「不儲存」的那個替代方案：要留存的人自己留一份。
 *
 * **時間資料的可信度**：節次鐘點依學校（lib/offerings/period-scheme.ts）—— 輔大照教務處原文，
 * 合成資料是合成的；學期起訖見 TERM_DATES（輔大 115 學年度照行事曆，其他學期推估並標明）。
 * 匯出的檔案會把這件事寫進去 —— 一份看起來很真、時間卻是假的行事曆，
 * 比沒有行事曆更糟。真實開課資料進來時兩者都必須一併更新。
 */

export type TermDates = { start: string; end: string; source: string };

/**
 * 學期起訖：每週上課的第一天到最後一天（含學期考試週）。課表匯出（ICS）的重複規則吃這張表。
 *
 * 輔大：有公告的學期用秘書室行事曆原文；沒有的依同一套規律推估，並在來源寫「推估」。
 *   115 學年度行事曆（秘書室，2026-04-17 公布）：
 *     上學期 2026-09-14（一）開始上課，學期考試到 2027-01-02（六）；之後兩週彈性多元學習週，沒有固定課
 *     下學期 2027-02-22（一）開始上課，學期考試到 2027-06-12（六）
 *   規律：上學期 9 月第二個週一、下學期 2 月第四個週一開始，上 16 週（含考試）。
 *   113-1 的實際開學日 2024-09-09 也是 9 月第二個週一。
 * 合成資料：上學期 9/1、下學期 2/15 起 18 週。
 */
const FJU_OFFICIAL: Record<string, { start: string; end: string }> = {
  "115-1": { start: "2026-09-14", end: "2027-01-02" },
  "115-2": { start: "2027-02-22", end: "2027-06-12" },
};
const FJU_SOURCE = "輔仁大學秘書室 115 學年度行事曆（2026-04-17 公布）";

export const TERM_DATES = {
  of(term: string, school = "demo"): TermDates | null {
    const m = /^(\d{3})-(\d)$/.exec(term);
    if (!m) return null;
    const half = Number(m[2]);
    if (half !== 1 && half !== 2) return null;
    // 民國轉西元；下學期跨年，115-2 的 2 月是西元 2027
    const year = Number(m[1]) + 1911 + (half === 2 ? 1 : 0);

    if (school === "fju") {
      const official = FJU_OFFICIAL[term];
      if (official) return { ...official, source: FJU_SOURCE };
      const start = nthMonday(year, half === 1 ? 9 : 2, half === 1 ? 2 : 4);
      return {
        start,
        end: addDays(start, 16 * 7 - 2),
        source: `推估：依${FJU_SOURCE}的規律（${term} 的行事曆未收錄）`,
      };
    }

    const start = half === 1 ? `${year}-09-01` : `${year}-02-15`;
    return { start, end: addDays(start, 18 * 7 - 1), source: "合成資料（一般大學行事曆）" };
  },
} as const;

/** 某年某月的第 n 個週一 */
function nthMonday(year: number, month: number, n: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + (n - 1) * 7);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const DAY_NAMES = ["", "一", "二", "三", "四", "五", "六", "日"];

// ---------------------------------------------------------------- CSV

/** CSV：不需要任何日期假設，欄位就是課表上看得到的東西。 */
export function toCsv(plan: Plan, scheme: PeriodScheme = periodScheme()): string {
  const rows: string[][] = [
    ["課號", "課程名稱", "學分", "教師", "類別", "星期", "節次", "時間", "時段原文"],
  ];

  for (const c of plan.courses) {
    if (c.slots.length === 0) {
      rows.push([c.code, c.name, String(c.credits), c.teacher, c.categoryLabel, "", "", "", c.slotText]);
      continue;
    }
    for (const s of c.slots) {
      const times = s.periods.map((p) => periodRow(scheme, p)).filter((t) => t !== undefined);
      const span = times.length > 0 ? `${times[0]!.start}-${times[times.length - 1]!.end}` : "";
      rows.push([
        c.code, c.name, String(c.credits), c.teacher, c.categoryLabel,
        // 節次欄印節次名稱，不印內部編號（輔大的內部第 6 節是 D5）
        DAY_NAMES[s.day] ?? String(s.day), s.periods.map((p) => periodRow(scheme, p)?.label ?? String(p)).join("、"), span, c.slotText,
      ]);
    }
  }

  // BOM：Excel 開沒有 BOM 的 UTF-8 CSV 會把中文顯示成亂碼
  return "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ---------------------------------------------------------------- ICS

/**
 * ICS：每門課每個時段一個每週重複事件。
 *
 * 時間一律用**浮動時間**（不帶 Z、不帶 TZID）—— 行事曆軟體會當成裝置本地時間。
 * 對校內課表這是對的：課就在當地的那個鐘點，不隨時區移動。帶 TZID 就得一併
 * 塞 VTIMEZONE，為了單一時區的課表不值得。
 */
export function toIcs(plan: Plan, now = new Date(), scheme: PeriodScheme = periodScheme()): string {
  const dates = TERM_DATES.of(plan.term, scheme.school);
  if (!dates) throw new Error(`無法解析學期代號 ${plan.term}`);

  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const until = dates.end.replace(/-/g, "") + "T235959";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aidit//修業規劃//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(`Aidit 選課建議 ${plan.term}`)}`,
  ];

  for (const c of plan.courses) {
    for (const [i, s] of c.slots.entries()) {
      const times = s.periods.map((p) => periodRow(scheme, p)).filter((t) => t !== undefined);
      if (times.length === 0) continue;

      // 單週從第 1 週、雙週從第 2 週開始，每兩週一次（輔大節次說明：依校行事曆排定之單／雙週）
      const first = firstDateOn(dates.start, s.day);
      const day = (s.weeks === "even" ? addDays(first, 7) : first).replace(/-/g, "");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${c.code}-${s.day}-${i}-${plan.term}@aidit`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${day}T${times[0]!.start.replace(":", "")}00`,
        `DTEND:${day}T${times[times.length - 1]!.end.replace(":", "")}00`,
        `RRULE:FREQ=WEEKLY;${s.weeks ? "INTERVAL=2;" : ""}UNTIL=${until}`,
        `SUMMARY:${icsText(`${c.name}（${c.code}）`)}`,
        `DESCRIPTION:${icsText(
          [
            `類別：${c.categoryLabel}`,
            `學分：${c.credits}`,
            c.teacher ? `教師：${c.teacher}` : "",
            `時段：${c.slotText}`,
            "",
            `節次時間來源：${scheme.source}（${scheme.asOf}）`,
            `學期起訖來源：${dates.source}`,
            "本檔為選課建議，非選課結果；實際開課時間以校方公告為準。",
          ].filter(Boolean).join("\n"),
        )}`,
        "END:VEVENT",
      );
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** 從學期起始日往後找第一個落在 day（1=一 … 7=日）的日期 */
function firstDateOn(start: string, day: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < 7; i++) {
    // getUTCDay: 0=日 … 6=六；本系統 1=一 … 7=日
    const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (wd === day) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/** RFC 5545：反斜線、分號、逗號要跳脫，換行寫成 \n */
function icsText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * RFC 5545 折行：每行最多 75 個**位元組**，續行以一個空白開頭。
 * 中文一個字 3 bytes，用字元數算會超長，有些解析器會整個事件吃掉。
 */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // 續行前綴的空白也佔一個位元組
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");
}
