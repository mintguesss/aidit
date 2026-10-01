import type { Citation, CitationVerdict } from "@/lib/types";
import { fuzzyBestMatch, normalize, numeralsOf } from "@/lib/util/text";

/**
 * 引用查核（docs/BACKEND.md §3）。
 *
 * 驗證的是「規則引用」，不是 LLM 的敘述 —— 目的是抓出被幻覺出來的規則。
 * 本檔不得呼叫 LLM（CI 會掃描 import）。
 */

export const FUZZY_THRESHOLD = 0.9;

export function verifyCitation(cite: Citation, corpus: Map<string, string>): CitationVerdict {
  const src = corpus.get(cite.docId);
  if (!src) return { citation: cite, ok: false, reason: "document_missing" };

  // 沒有 quote 的欄位事後無法驗證，等同於沒有依據
  if (!cite.quote || cite.quote.trim() === "") {
    return { citation: cite, ok: false, reason: "quote_missing" };
  }

  const q = normalize(cite.quote);
  const body = normalize(src);
  if (body.includes(q)) return { citation: cite, ok: true, method: "exact" };

  const best = fuzzyBestMatch(q, body);
  if (best.ratio >= FUZZY_THRESHOLD) {
    // 夠像，但數字必須完全一樣。只差一個數字的引文相似度一樣很高，
    // 而那一個數字往往就是整條規則的重點（學分數、學年、門數）。
    // 邊界切到數字中間時也會判不符 —— 那是安全的方向：降級成待確認，而不是放過錯的數字。
    if (numeralsOf(q).join("|") !== numeralsOf(best.window).join("|")) {
      return { citation: cite, ok: false, reason: "number_mismatch", ratio: round(best.ratio) };
    }
    // method: "fuzzy" 要顯示在 trace 上，不要藏起來
    return { citation: cite, ok: true, method: "fuzzy", ratio: round(best.ratio) };
  }
  return { citation: cite, ok: false, reason: "quote_not_found", ratio: round(best.ratio) };
}

export type VerifyReport = {
  verified: CitationVerdict[];
  failed: CitationVerdict[];
  fuzzyCount: number;
};

export function verifyAll(citations: Citation[], corpus: Map<string, string>): VerifyReport {
  const seen = new Set<string>();
  const results: CitationVerdict[] = [];
  for (const c of citations) {
    const key = `${c.docId}|${c.locator}|${c.quote ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(verifyCitation(c, corpus));
  }
  return {
    verified: results.filter((r) => r.ok),
    failed: results.filter((r) => !r.ok),
    fuzzyCount: results.filter((r) => r.ok && r.method === "fuzzy").length,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
