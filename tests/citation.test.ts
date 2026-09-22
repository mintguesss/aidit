import { describe, expect, it } from "vitest";
import { verifyCitation, verifyAll, FUZZY_THRESHOLD } from "@/lib/verify/citation";
import { loadCorpus, loadRulePacks } from "@/lib/rules/loader";
import { normalize } from "@/lib/util/text";
import type { Citation } from "@/lib/types";

const corpus = loadCorpus();

const cite = (over: Partial<Citation> = {}): Citation => ({
  docId: "plan-im-111",
  docTitle: "111 學年度資訊管理學系課程規劃表",
  locator: "第 3 頁",
  quote: "通識涵養課程應修滿十二學分",
  ...over,
});

describe("citation.verify", () => {
  it("逐字相符時以 exact 通過", () => {
    const r = verifyCitation(cite(), corpus);
    expect(r.ok).toBe(true);
    expect(r.method).toBe("exact");
  });

  it("僅排版差異（空白、全形）仍以 exact 通過", () => {
    const r = verifyCitation(cite({ quote: "通識涵養課程　應修滿十二學分。" }), corpus);
    expect(r.ok).toBe(true);
    expect(r.method).toBe("exact");
  });

  it("少量字元差異以 fuzzy 通過，且 method 必須被回報而非藏起來", () => {
    // 「十二學分」誤植為「十二學份」：13 字中差 1 字，相似度 0.923
    const r = verifyCitation(cite({ quote: "通識涵養課程應修滿十二學份" }), corpus);
    expect(r.ok).toBe(true);
    expect(r.method).toBe("fuzzy");
    expect(r.ratio).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
  });

  it("原文查無相符片段時失敗，並附最佳相似度供查核", () => {
    const r = verifyCitation(cite({ quote: "通識涵養課程應修滿二十四學分並另修語言課程六學分" }), corpus);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("quote_not_found");
    expect(r.ratio).toBeLessThan(FUZZY_THRESHOLD);
  });

  it("沒有 quote 的引用一律不通過 —— 事後無法驗證等同於沒有依據", () => {
    const r = verifyCitation(cite({ quote: undefined }), corpus);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("quote_missing");
  });

  it("來源文件不存在時明確回報，不得默默通過", () => {
    const r = verifyCitation(cite({ docId: "not-a-doc" }), corpus);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("document_missing");
  });
});

describe("規則包的每一條引用都必須能回查原文", () => {
  it("im-111 的所有 citation 全數通過", () => {
    const pack = loadRulePacks().find((p) => p.id === "im-111")!;
    const citations: Citation[] = [];
    const push = (c: { docId: string; locator: string; quote?: string }) =>
      citations.push({
        docId: c.docId,
        docTitle: pack.documents.find((d) => d.id === c.docId)?.title ?? c.docId,
        locator: c.locator,
        quote: c.quote,
      });

    for (const cat of pack.categories) {
      push(cat.citation);
      cat.subRules.forEach((s) => push(s.citation));
      cat.ambiguities.forEach((a) => push(a.citation));
    }
    pack.graduationChecks.forEach((g) => push(g.citation));
    Object.values(pack.overflowPolicy).forEach((o) => push(o.citation));

    const report = verifyAll(citations, corpus);
    expect(report.failed.map((f) => `${f.citation.locator}：${f.reason}`)).toEqual([]);
  });
});

describe("normalize", () => {
  it("去除空白、標點並統一全半形", () => {
    expect(normalize("第 24 條：自由選修（超修）")).toBe(normalize("第24條自由選修超修"));
    expect(normalize("ＡＢＣ")).toBe("abc");
  });
});
