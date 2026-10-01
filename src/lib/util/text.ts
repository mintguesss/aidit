/**
 * 文字正規化與模糊比對。citation.verify 的地基，
 * 因此本檔不得引入任何外部服務或 LLM。
 */

/** 全形英數與標點 → 半形 */
function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/**
 * 要移除的字元：空白、CJK 標點、ASCII 標點。
 * 以 unicode escape 描述，避免原始碼編碼差異影響比對結果。
 */
const PUNCT_SOURCE =
  "[" +
  "\\s\\u3000\\u2000-\\u200F\\u2028\\u2029" + // 各式空白
  "\\u3001-\\u303F" + // 、。〈〉《》「」『』【】〔〕…‧ 等 CJK 標點
  "\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65" + // 全形標點
  "\\u2010-\\u2027\\u2030-\\u205E" + // – — ‧ 等
  "!-\\/:-@\\[-`{-~" + // ASCII 標點
  "]";

const PUNCT_RE = new RegExp(PUNCT_SOURCE, "g");

/**
 * 去空白、全半形統一、去標點。
 * 目的是讓「原文排版差異」不影響引用驗證，但不改變任何實質字元。
 */
export function normalize(s: string): string {
  return toHalfWidth(s).replace(PUNCT_RE, "").toLowerCase();
}

/** Levenshtein 距離，O(|a|·|b|)，僅用於短 quote 比對 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

export type FuzzyMatch = { ratio: number; at: number; window: string };

/** 步長為 1 的長度上限；引用片段一般 < 60 字，遠低於此 */
const EXACT_STRIDE_MAX = 200;

/**
 * 在 haystack 中以滑動視窗尋找與 needle 最相近的片段。
 *
 * 短 needle 一律逐字滑動。跳著滑會錯過最佳對齊位置，
 * 讓一個只差一個字的引用被判成「原文查無」—— 那會把正確的結論誤降為待確認。
 * 長 needle 才退回較粗的步長以控制耗時。
 */
export function fuzzyBestMatch(needle: string, haystack: string): FuzzyMatch {
  if (needle.length === 0 || haystack.length === 0) return { ratio: 0, at: -1, window: "" };

  const n = needle.length;
  const step = n <= EXACT_STRIDE_MAX ? 1 : Math.max(1, Math.floor(n / 8));
  let best: FuzzyMatch = { ratio: 0, at: -1, window: "" };

  for (let i = 0; i < haystack.length; i += step) {
    const window = haystack.slice(i, i + n);
    if (window.length < n * 0.6) break;
    const dist = levenshtein(needle, window);
    const ratio = 1 - dist / Math.max(n, window.length);
    if (ratio > best.ratio) best = { ratio, at: i, window };
    if (best.ratio === 1) break;
  }
  return best;
}

/**
 * 文字裡的數字，依出現順序：阿拉伯數字與國字數字的連續段落。
 *
 * 模糊比對用來容忍排版或 OCR 的小差異，但規則裡最關鍵的就是數字 ——
 * 「上限為二十五學分」改成「二十八學分」只差一個字，相似度 95%，
 * 模糊比對會判通過。引用回查拿這個函式確認兩邊的數字完全一樣。
 */
export function numeralsOf(s: string): string[] {
  return s.match(/[0-9零〇一二兩三四五六七八九十百千萬]+/g) ?? [];
}

/** 穩定字串比較，供指派決勝使用（不依賴 locale） */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
