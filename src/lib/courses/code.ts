/**
 * 課號格式。
 *
 * 不同學校的課號長得不一樣，這裡列出系統認得的每一種。原本「兩碼英文＋四碼數字」
 * 寫死在八個檔案裡，那是合成資料的格式；接上第一所真實學校（輔大，五碼數字）時，
 * 它的每一個課號都會在參數清洗、意圖解析、規則包驗證被當成非法輸入擋掉。
 *
 * 新增一所學校就是在 FORMATS 加一列，並在旁邊寫明格式出處。
 *
 * 這裡只判斷「長得像課號」。課號是否真的存在，要對照開課資料或規則包，
 * 這個模組不負責 —— 格式對了不代表課存在。
 */

type Format = {
  /** 用在哪裡 */
  school: string;
  /** 完整課號的樣式（不含錨點） */
  pattern: string;
  /** 在一段文字裡找課號時用的樣式（含邊界條件，避免從更長的數字裡切出一段） */
  inText: string;
};

const FORMATS: Format[] = [
  {
    school: "合成資料（demo 與評測）",
    pattern: "[A-Z]{2}\\d{4}",
    inText: "[A-Z]{2}\\d{4}(?!\\d)",
  },
  {
    // 輔仁大學必選修科目表的「科目代碼」欄，例如 02390（微積分）、24495（程式設計概論）
    school: "輔仁大學",
    pattern: "\\d{5}",
    // 前後都不能再接數字：學號是九碼，不能從中間切出五碼當課號
    inText: "(?<!\\d)\\d{5}(?!\\d)",
  },
];

/** 完整比對一個字串是否為課號 */
export const COURSE_CODE_RE = new RegExp(`^(?:${FORMATS.map((f) => f.pattern).join("|")})$`);

const IN_TEXT = `(?:${FORMATS.map((f) => f.inText).join("|")})`;

export function isCourseCode(s: unknown): s is string {
  return typeof s === "string" && COURSE_CODE_RE.test(s);
}

/** 文字中出現的第一個課號 */
export function findCourseCode(text: string): string | undefined {
  return new RegExp(IN_TEXT).exec(text)?.[0];
}

/** 文字中出現的所有課號，依出現順序、不去重 */
export function findCourseCodes(text: string): string[] {
  return [...text.matchAll(new RegExp(IN_TEXT, "g"))].map((m) => m[0]);
}

/** 錯誤訊息用：目前認得的格式 */
export function describeCourseCodeFormats(): string {
  return FORMATS.map((f) => `${f.school}：${f.pattern}`).join("；");
}
