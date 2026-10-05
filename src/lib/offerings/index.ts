import type { Offering, Prerequisite, Term } from "@/lib/types";
import { parseSlots } from "@/lib/solver/slots";
import { RAW_OFFERINGS, type RawOffering } from "./raw";
import { DEFAULT_SCHOOL } from "@/lib/schools";
// 輔大 115-1：學生資訊平台的公開課程查詢（scripts/fju-sis-fetch.py → fju-sis-offerings.py），
// 資管系＋全人、基本能力、通識，含開課名額
import FJU_115_1 from "./data/fju-115-1.json";
// 輔大 113-1：同一條管線抓的歷年資料，給「大二結束、準備升大三」的示範學生排課用
import FJU_113_1 from "./data/fju-113-1.json";
// 輔大資管系 115-2 系上課表（scripts/fju-timetable.py → fju-offerings-raw.py）。
// 課程查詢系統還沒公布 115-2，公布後改用上面那條管線重抓
import FJU_115_2 from "./data/fju-115-2.json";
import { findCourseCodes } from "@/lib/courses/code";

/**
 * 開課資料正規化（docs/BACKEND.md §4）。
 *
 * 兩個關鍵行為：
 *   1. 時段解析失敗的課程要「標記」而不是丟棄
 *   2. 從大綱文字抽出的先修（extracted）不得當硬限制，
 *      否則會造成無聲的錯誤建議 —— 學生看不到自己被少推薦了什麼
 */

export function normalizeOffering(raw: RawOffering): Offering {
  const parsed = parseSlots(raw.slotText);
  return {
    school: raw.school ?? DEFAULT_SCHOOL,
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
    const codes = findCourseCodes(raw.prereqField);
    if (codes.length > 0) out.push({ codes, confidence: "explicit" });
  }
  if (raw.syllabusPrereqText) {
    // 大綱文字通常只寫課名不寫課號；沒有課號就沒有可靠對照，標為 unknown
    const codes = findCourseCodes(raw.syllabusPrereqText);
    out.push({
      codes,
      confidence: codes.length > 0 ? "extracted" : "unknown",
      sourceText: raw.syllabusPrereqText,
    });
  }
  return out;
}

/** repo 裡的開課資料：CI 與離線環境的基準，也是資料庫還沒有那一學期時的退路 */
const REPO_RAW: RawOffering[] = [
  ...RAW_OFFERINGS,
  ...(FJU_113_1 as RawOffering[]),
  ...(FJU_115_1 as RawOffering[]),
  ...(FJU_115_2 as RawOffering[]),
];

/** 資料庫裡的開課資料，由 offerings/published.ts 的 preloadOfferings() 載入 */
let published: RawOffering[] = [];

const termKey = (r: Pick<RawOffering, "school" | "year" | "term">) => `${r.school ?? DEFAULT_SCHOOL}:${r.year}-${r.term}`;

/** 換上資料庫的版本。同一學期以資料庫為準，整學期取代，不逐班合併 */
export function setPublishedOfferings(rows: RawOffering[]): void {
  published = rows;
  cache = null;
}

/** 全部原始列：資料庫有的學期用資料庫的，其他用 repo 的 */
export function rawOfferings(): RawOffering[] {
  if (published.length === 0) return REPO_RAW;
  const inDb = new Set(published.map(termKey));
  return [...REPO_RAW.filter((r) => !inDb.has(termKey(r))), ...published];
}

let cache: Offering[] | null = null;

/**
 * 全部開課資料。指定學校時只回傳那一所的。
 *
 * 用課號查詢（課程頁、名稱對照）時可以不指定：各校課號格式不重疊
 * （合成資料 IM4045、輔大 02390），全域查不會查錯。
 * **用課名找課、排課時一定要指定**：各校常有同名的課（資料結構、微積分這類），不分學校就會拿到別校的課。
 */
export function allOfferings(school?: string): Offering[] {
  if (!cache) cache = rawOfferings().map(normalizeOffering);
  return school === undefined ? cache : cache.filter((o) => o.school === school);
}

/** 某一所學校某一學期的開課。排課只能用這個 —— 不能把別校的課排進課表 */
export function offeringsFor(year: number, term: Term, school: string = DEFAULT_SCHOOL): Offering[] {
  return allOfferings(school).filter((o) => o.year === year && o.term === term);
}

/** 現行有開課的課號集合：判斷抵免課號是否已停開。各校課號格式不重疊，全域即可 */
export function activeCourseCodes(): Set<string> {
  return new Set(allOfferings().map((o) => o.code));
}

/**
 * 修課餘額。開課資料沒有提供人數時回傳 null —— **未知不是 0**：
 * 當成 0 會把課全部當額滿排除，當成有位置又是編造。呼叫端要分開處理。
 */
export function remainingSeats(o: Pick<Offering, "capacity" | "enrolled">): number | null {
  if (o.capacity === undefined || o.enrolled === undefined) return null;
  return Math.max(0, o.capacity - o.enrolled);
}

/** 資料時效：決賽要能說明開課資料抓取時間 */
export function fetchedAt(school: string = DEFAULT_SCHOOL): string {
  const rows = rawOfferings().filter((r) => (r.school ?? DEFAULT_SCHOOL) === school);
  return rows.reduce(
    (latest, r) => (r.fetchedAt > latest ? r.fetchedAt : latest),
    rows[0]?.fetchedAt ?? new Date().toISOString(),
  );
}

export { RAW_OFFERINGS } from "./raw";
export type { RawOffering } from "./raw";
