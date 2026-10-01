import { describe, it, expect } from "vitest";
import { locate } from "@/lib/review/store";
import { verifyCitation } from "@/lib/verify/citation";

/**
 * 校對頁的原文定位必須與 citation.verify 用同一套規則。
 *
 * 輔大的語料是 pdfplumber 版面模式抽出來的，有大量補齊空白與換行。
 * 原本只用 indexOf，結果是驗證通過的引文在校對頁上 17 項有 10 項找不到原文位置 ——
 * 校對的人看不到上下文，等於要自己去翻 PDF。
 */

const source = "第二條 本系學士班畢業應修之課程如下：\n（一）修滿全人教育核心課程         8學分1。\n（二）修滿基本能力課程 12學分";

describe("校對頁的原文定位", () => {
  it("完全相同的字串照舊直接找到", () => {
    const c = locate(source, "修滿基本能力課程 12學分");
    expect(c?.match).toBe("修滿基本能力課程 12學分");
  });

  it("原文有補齊空白：仍找得到，且高亮的是原文那一段", () => {
    const c = locate(source, "修滿全人教育核心課程 8學分");
    expect(c).not.toBeNull();
    expect(c!.match).toBe("修滿全人教育核心課程         8學分");
    expect(c!.before.endsWith("（一）")).toBe(true);
  });

  it("跨行的引文也找得到", () => {
    const c = locate(source, "8學分1。（二）修滿基本能力");
    expect(c).not.toBeNull();
    expect(c!.match).toContain("\n");
  });

  it("驗證通過的引文，定位也一定找得到 —— 兩者規則一致", () => {
    const quote = "修滿全人教育核心課程 8學分";
    const v = verifyCitation({ docId: "d", docTitle: "測試", locator: "x", quote }, new Map([["d", source]]));
    expect(v.ok).toBe(true);
    expect(locate(source, quote)).not.toBeNull();
  });

  it("原文沒有的內容找不到", () => {
    expect(locate(source, "修滿全人教育核心課程 10學分")).toBeNull();
  });
});
