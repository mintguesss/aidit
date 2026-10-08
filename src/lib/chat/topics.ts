import type { Offering } from "@/lib/types";

/**
 * 「想修一堂 AI 相關的課」：主題 → 開課資料裡符合的課（TODO G2）。
 *
 * 比對課名，不做語意比對、不用模型：比對結果要說得出為什麼。
 * 常見主題附同義詞（AI 相關的課在課名上多半寫「人工智慧」「機器學習」…）；
 * 沒列的主題就照字面找課名裡有這幾個字的課。
 */

const SYNONYMS: [RegExp, string[]][] = [
  [/^(ai|人工智慧|人工智能|ai人工智慧)$/i, ["AI", "人工智慧", "機器學習", "深度學習", "大語言模型", "語言模型", "生成式", "電腦視覺", "自然語言"]],
  [/^(程式|寫程式|程式設計|coding|programming)$/i, ["程式", "Python", "Java", "Web", "APP", "App", "軟體", "演算法", "資料結構"]],
  [/^(資安|資訊安全|網路安全|security)$/i, ["資安", "資訊安全", "網路安全", "密碼", "駭客"]],
  [/^(資料|數據|大數據|資料分析|數據分析|data)$/i, ["資料", "數據", "巨量", "大數據", "分析", "統計"]],
  [/^(雲端|cloud)$/i, ["雲端"]],
  [/^(管理|企管)$/i, ["管理"]],
  [/^(行銷|marketing)$/i, ["行銷", "電子商務", "消費者"]],
  [/^(財金|財務|金融|投資)$/i, ["財務", "金融", "投資", "會計"]],
  [/^(英文|英語|english)$/i, ["英文", "英語", "-英"]],
];

/** 是不是已知的主題（同義詞表裡有的，或英文縮寫）。「換成一堂 AI 的課」沒寫「相關」時用來判斷那是主題不是課名 */
export function isKnownTopic(word: string): boolean {
  const t = word.replace(/\s/g, "");
  return /^[A-Za-z]{1,12}$/.test(t) || SYNONYMS.some(([re]) => re.test(t));
}

/** 主題的比對字詞 */
export function topicTerms(topic: string): string[] {
  const t = topic.replace(/\s|相關|有關|的課程?|課程?$/g, "");
  if (!t) return [];
  const hit = SYNONYMS.find(([re]) => re.test(t));
  return hit ? hit[1] : [t];
}

/** 課名有比對字詞的課號（英文不分大小寫） */
export function topicCodes(offerings: Pick<Offering, "code" | "name">[], topic: string): string[] {
  const terms = topicTerms(topic).map((x) => x.toLowerCase());
  if (terms.length === 0) return [];
  return [...new Set(offerings.filter((o) => terms.some((x) => o.name.toLowerCase().includes(x))).map((o) => o.code))];
}
