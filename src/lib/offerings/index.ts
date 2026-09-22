import type { Offering, Prerequisite, Term } from "@/lib/types";
import { parseSlots } from "@/lib/solver/slots";
import { RAW_OFFERINGS, type RawOffering } from "./raw";

/**
 * 開課資料正規化（docs/BACKEND.md §4）。
 *
 * 兩個關鍵行為：
 *   1. 時段解析失敗的課程要「標記」而不是丟棄
 *   2. 從大綱文字抽出的先修（extracted）不得當硬限制，
 *      否則會造成無聲的錯誤建議 —— 學生看不到自己被少推薦了什麼
 */

const PREREQ_CODE_RE = /\b([A-Z]{2}\d{4})\b/g;

export function normalizeOffering(raw: RawOffering): Offering {
  const parsed = parseSlots(raw.slotText);
  return {
    code: raw.code,
    name: raw.name,
    credits: raw.credits,
    year: raw.year,
    term: raw.term,
    teacher: raw.teacher,
    slots: parsed.slots,
    slotsUnknown: parsed.unknown,
    rawSlotText: raw.slotText,
    dept: raw.dept,
    college: raw.college,
    category: raw.category,
    generalDomain: raw.generalDomain,
    prerequisites: toPrerequisites(raw),
    capacity: raw.capacity,
    enrolled: raw.enrolled,
  };
}

function toPrerequisites(raw: RawOffering): Prerequisite[] {
  const out: Prerequisite[] = [];
  if (raw.prereqField) {
    const codes = raw.prereqField.match(PREREQ_CODE_RE) ?? [];
    if (codes.length > 0) out.push({ codes, confidence: "explicit" });
  }
  if (raw.syllabusPrereqText) {
    // 大綱文字通常只寫課名不寫課號；沒有課號就沒有可靠對照，標為 unknown
    const codes = raw.syllabusPrereqText.match(PREREQ_CODE_RE) ?? [];
    out.push({
      codes,
      confidence: codes.length > 0 ? "extracted" : "unknown",
      sourceText: raw.syllabusPrereqText,
    });
  }
  return out;
}

let cache: Offering[] | null = null;

export function allOfferings(): Offering[] {
  if (!cache) cache = RAW_OFFERINGS.map(normalizeOffering);
  return cache;
}

export function offeringsFor(year: number, term: Term): Offering[] {
  return allOfferings().filter((o) => o.year === year && o.term === term);
}

/** 現行有開課的課號集合：判斷抵免課號是否已停開 */
export function activeCourseCodes(): Set<string> {
  return new Set(allOfferings().map((o) => o.code));
}

export function remainingSeats(o: Offering): number {
  return Math.max(0, o.capacity - o.enrolled);
}

/** 資料時效：決賽要能說明開課資料抓取時間 */
export function fetchedAt(): string {
  return RAW_OFFERINGS.reduce(
    (latest, r) => (r.fetchedAt > latest ? r.fetchedAt : latest),
    RAW_OFFERINGS[0]?.fetchedAt ?? new Date().toISOString(),
  );
}

export { RAW_OFFERINGS } from "./raw";
export type { RawOffering } from "./raw";
