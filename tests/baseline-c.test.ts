import { describe, expect, it } from "vitest";
import { REAL_CASES } from "@/eval/baseline-c/cases";
import { compactText, offlineBaselineAnswer, type BaselineAnswer } from "@/eval/baseline-c/prompt";
import { consistency, scoreRun } from "@/eval/baseline-c/score";

/** 基準 C 的評分：對照組的每一種答法要被歸到正確的類別，否則比較數字就不可信 */

const year2 = REAL_CASES.find((c) => c.fixture === "fju-im-111-year2")!;
const full = REAL_CASES.find((c) => c.fixture === "fju-im-111-full")!;
const corpus = new Map([["doc", "（六）畢業學分數為全人教育核心課程、基本能力課程、通識涵養課程、專業必修課程及選修課程五者之學分數，至少 128學分。"]]);

/** 照標準答案填的完美答案，再由各測試改壞一處 */
function perfect(c = year2): BaselineAnswer {
  return {
    categories: c.expect.categories.map((x) => ({ name: x.name, earned: x.earned, unmet: x.unmet, needsReview: false, reason: null })),
    totalUnmet: c.expect.totalUnmet,
    missingGenEdDomains: [...c.expect.missingGenEdDomains],
    canGraduate: c.expect.canGraduate,
    holds: [],
    citations: [],
  };
}

describe("基準 C 評分", () => {
  it("照標準答案答 → 答對", () => {
    expect(scoreRun(perfect(), year2, corpus).outcome).toBe("correct");
  });

  it("任一類數字錯 → 錯答，並寫出哪裡錯", () => {
    const a = perfect();
    a.categories[3]!.unmet = 9;
    const s = scoreRun(a, year2, corpus);
    expect(s.outcome).toBe("wrong");
    expect(s.errors.join()).toContain("院系必修課程：還差 9，應為 12");
  });

  it("領域名稱多了「通識」兩個字不算錯（2026-10-12 第一次評分把 9 次答對誤判成錯答）", () => {
    const a = perfect();
    a.missingGenEdDomains = ["社會科學通識"];
    expect(scoreRun(a, year2, corpus).outcome).toBe("correct");
  });

  it("引用成績單：拿給模型的成績單核對，不是去規章裡找", () => {
    const a = perfect();
    a.citations = [{ claim: "大學入門已修", docId: "成績單", quote: "00155｜大學入門｜2學分｜必修｜及格" }];
    const transcript = "111上｜00155｜大學入門｜2學分｜必修｜及格｜開課單位 IT";
    expect(scoreRun(a, year2, corpus, transcript).citations.failed).toHaveLength(0);
    // 成績單上沒有的句子照樣抓出來
    a.citations = [{ claim: "大學入門已修", docId: "成績單", quote: "00155｜大學入門｜3學分" }];
    expect(scoreRun(a, year2, corpus, transcript).citations.failed).toHaveLength(1);
  });

  it("某類填 null 或標轉人工 → 轉人工，不算錯", () => {
    const a = perfect();
    a.categories[0]!.unmet = null;
    a.categories[1]!.needsReview = true;
    a.totalUnmet = null;
    expect(scoreRun(a, year2, corpus).outcome).toBe("abstain");
  });

  it("漏掉一整類 → 轉人工", () => {
    const a = perfect();
    a.categories.pop();
    expect(scoreRun(a, year2, corpus).outcome).toBe("abstain");
  });

  it("類別與領域名稱有沒有「課程」「領域」、空白都不影響比對", () => {
    const a = perfect();
    a.categories = a.categories.map((x) => ({ ...x, name: x.name.replace("課程", "") }));
    a.missingGenEdDomains = ["社會科學領域"];
    expect(scoreRun(a, year2, corpus).outcome).toBe("correct");
  });

  it("通識缺的領域答錯 → 錯答", () => {
    const a = perfect();
    a.missingGenEdDomains = ["自然與科技"];
    expect(scoreRun(a, year2, corpus).outcome).toBe("wrong");
  });

  it("學分修滿但非學分條件無法確認，卻回答可以畢業 → 誤判可畢業", () => {
    const a = perfect(full);
    a.canGraduate = "yes";
    const s = scoreRun(a, full, corpus);
    expect(s.outcome).toBe("wrong");
    expect(s.canGraduate.falseGraduate).toBe(true);
  });

  it("還不能畢業時回答需要人工確認 → 轉人工，不算錯", () => {
    const a = perfect();
    a.canGraduate = "needs-review";
    expect(scoreRun(a, year2, corpus).outcome).toBe("abstain");
  });

  it("引文：原文有的算通過，編出來的、數字被改的算失敗", () => {
    const a = perfect();
    a.citations = [
      { claim: "總學分", docId: "doc", quote: "至少 128學分" },
      { claim: "總學分", docId: "doc", quote: "至少 132學分" },
      { claim: "英檢", docId: "doc", quote: "須通過全民英檢中級" },
      { claim: "不存在的文件", docId: "nope", quote: "至少 128學分" },
    ];
    const s = scoreRun(a, year2, corpus);
    expect(s.citations).toMatchObject({ total: 4, verified: 1 });
  });

  it("離線替身全部轉人工，不會被算成答對或錯答", () => {
    const names = year2.expect.categories.map((x) => x.name);
    expect(scoreRun(offlineBaselineAnswer(names), year2, corpus).outcome).toBe("abstain");
  });
});

describe("同題多次是否一致", () => {
  it("只看會影響學生決定的部分；理由、引文不同不算不一致", () => {
    const a = perfect();
    const b = { ...perfect(), citations: [{ claim: "x", docId: "doc", quote: "至少 128學分" }] };
    b.categories[0] = { ...b.categories[0]!, reason: "不同的理由" };
    expect(consistency([a, b]).consistent).toBe(true);
  });

  it("任一類數字不同就不一致", () => {
    const b = perfect();
    b.categories[4]!.unmet = 16;
    expect(consistency([perfect(), b, perfect()])).toEqual({ consistent: false, distinct: 2 });
  });
});

describe("標準答案自己要對得起來", () => {
  it.each(REAL_CASES)("$label：各類還差加起來等於合計", (c) => {
    expect(c.expect.categories.reduce((a, x) => a + x.unmet, 0)).toBe(c.expect.totalUnmet);
    for (const x of c.expect.categories) expect(x.required - x.earned).toBe(x.unmet);
  });
});

describe("給模型的原文只壓空白、不刪字", () => {
  it("對齊用的空白壓成一個，連續空行只留一行", () => {
    expect(compactText("類別    學分　　備註\n\n\n\n下一段")).toBe("類別 學分 備註\n\n下一段");
  });
});
