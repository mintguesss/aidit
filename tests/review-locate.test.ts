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

describe("前後文以整行為單位", () => {
  const rules = [
    "第二條 本系學士班畢業應修之課程如下：",
    "",
    "（五）選修課程中包含本系專業選修課程至少 10學分。",
    "（六）畢業學分數為全人教育核心課程、基本能力課程、通識涵養課程、專業必修課程及",
    "     選修課程五者之學分數，至少         128學分(同註1)。",
    "",
    "（七）學科學習能力檢測：通過資訊學科學習能力檢測。",
  ].join("\n");

  it("往前補到上一個非空白行，往後補到下一個非空白行 —— 不從句子中間切", () => {
    const c = locate(rules, "選修課程五者之學分數，至少 128學分")!;
    expect(c.before.startsWith("（六）畢業學分數為")).toBe(true);
    expect(c.after).toContain("(同註1)。");
    expect(c.after.trim().endsWith("（七）學科學習能力檢測：通過資訊學科學習能力檢測。")).toBe(true);
  });

  it("跳過空白行再找上一行", () => {
    const c = locate(rules, "（五）選修課程中包含本系專業選修課程")!;
    expect(c.before.startsWith("第二條")).toBe(true);
  });

  it("單側太長時截斷並標「…」", () => {
    const long = "甲".repeat(1000) + "目標句" + "乙".repeat(1000);
    const c = locate(long, "目標句")!;
    expect(c.before.startsWith("…")).toBe(true);
    expect(c.after.endsWith("…")).toBe(true);
    expect(c.before.length).toBeLessThanOrEqual(301);
  });
});
