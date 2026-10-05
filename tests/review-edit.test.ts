import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdit, editableOf, EditError, type Editable } from "@/lib/review/edit";
import { corpusFromFiles } from "@/lib/review/drafts";
import { numberValuesOf } from "@/lib/util/text";

/**
 * 校對頁的直接修改（lib/review/edit.ts）。
 *
 * 校對者從網頁改出來的內容，要過跟上傳草稿一樣的檢查，外加「改了數字，依據的原文裡要有這個數字」。
 */

const DRAFT = "docs/review/fju-im-111.draft.json";
const draft = JSON.parse(readFileSync(DRAFT, "utf8")) as Record<string, unknown>;
const corpus = corpusFromFiles(draft);

const problemsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof EditError) return e.problems;
    throw e;
  }
  return [];
};

describe("中文數字", () => {
  it("原文的「十二」「二十五」「三十二」換成整數", () => {
    expect(numberValuesOf("第一、二、三學年每學期至少須修習十二學分")).toEqual([1, 2, 3, 12]);
    expect(numberValuesOf("上限為二十五學分，得超修至三十二學分")).toEqual([25, 32]);
    expect(numberValuesOf("至少 128學分")).toEqual([128]);
  });
});

describe("applyEdit", () => {
  const cat = (id: string) => editableOf(draft, `category:${id}`) as Extract<Editable, { kind: "category" }>;

  // 通識 12 改成 4：原文「通識：12學分（人文與藝術(PT)4學分…」裡有 4
  const planQuote = { docId: "fju-im-plan-111", locator: "第 4 頁 畢業規定摘要", quote: "通識：12學分（人文與藝術(PT)4學分" };

  it("改學分但沒換依據：原文裡沒有新數字就擋下", () => {
    const v = { ...cat("general"), credits: 4 };
    const p = problemsOf(() => applyEdit(draft, corpus, "category:general", v, { rebalanceFree: true }));
    expect(p.some((x) => x.includes("依據的原文裡沒有 4"))).toBe(true);
  });

  it("改學分沒調選修課程：加總不等於 128 就擋下", () => {
    const v = { ...cat("general"), credits: 4, citation: planQuote };
    const p = problemsOf(() => applyEdit(draft, corpus, "category:general", v));
    expect(p.some((x) => x.includes("128"))).toBe(true);
  });

  it("勾選一併調整：承接類別（選修課程）跟著改，變更清單寫出兩邊", () => {
    const v = { ...cat("general"), credits: 4, citation: planQuote };
    const r = applyEdit(draft, corpus, "category:general", v, { rebalanceFree: true });
    const cats = r.draft.categories as { id: string; credits: number }[];
    expect(cats.find((c) => c.id === "general")!.credits).toBe(4);
    expect(cats.find((c) => c.id === "free-elective")!.credits).toBe(40);
    expect(r.changes).toContain("學分：12 → 4");
    expect(r.changes.some((c) => c.includes("選修課程") && c.includes("32 → 40"))).toBe(true);
  });

  it("本系選修的分項條件也能改：數字要在原文裡", () => {
    const b = editableOf(draft, "subRule:dept-elective-10") as Extract<Editable, { kind: "deptCredits" }>;
    expect(b.minCredits).toBe(10);
    expect(problemsOf(() => applyEdit(draft, corpus, "subRule:dept-elective-10", { ...b, minCredits: 9 })).join()).toContain("沒有 9");
  });

  it("依據的句子原文裡沒有：擋下", () => {
    const v = { ...cat("holistic-core"), citation: { ...cat("holistic-core").citation, quote: "全人核心課程：10學分，這句原文沒有" } };
    const p = problemsOf(() => applyEdit(draft, corpus, "category:holistic-core", v));
    expect(p.some((x) => x.includes("查無相符片段"))).toBe(true);
  });

  it("改課名開頭：照樣存，變更清單看得懂", () => {
    const v = { ...cat("basic-skills"), prefixes: ["外國語文", "英文"] };
    const r = applyEdit(draft, corpus, "category:basic-skills", v);
    const m = (r.draft.categories as { id: string; match: { prefixes?: string[] } }[]).find((c) => c.id === "basic-skills")!.match;
    expect(m.prefixes).toEqual(["外國語文", "英文"]);
    expect(r.changes).toEqual(["課名開頭：外國語文 → 外國語文、英文"]);
  });

  it("課程清單：新增的課號連課名一起記下（課名只用於顯示）", () => {
    const b = cat("holistic-core");
    const v = { ...b, courses: [...b.courses!, { code: "00125", title: "體育" }] };
    // 加了 0 學分的課，學分不變
    const r = applyEdit(draft, corpus, "category:holistic-core", v);
    expect((r.draft._draft as { courseTitles: Record<string, string> }).courseTitles["00125"]).toBe("體育");
  });

  it("畢業條件改成看課名卻沒填課名：擋下", () => {
    const b = editableOf(draft, "check:advisor-time") as Extract<Editable, { kind: "check" }>;
    const p = problemsOf(() => applyEdit(draft, corpus, "check:advisor-time", { ...b, rule: "passedCourse", courseNames: [] }));
    expect(p.some((x) => x.includes("至少一個課名"))).toBe(true);
  });

  it("學分上限改成原文沒有的數字：擋下；改回原文有的數字（三十二）：通過", () => {
    const b = editableOf(draft, "termLimits:1") as Extract<Editable, { kind: "termLimits" }>;
    expect(problemsOf(() => applyEdit(draft, corpus, "termLimits:1", { ...b, maxCredits: 30 })).join()).toContain("沒有 30");
    const r = applyEdit(draft, corpus, "termLimits:1", { ...b, maxCredits: 32 });
    expect(r.changes).toContain("每學期最多：25 → 32");
  });

  it("沒改任何東西：擋下", () => {
    expect(problemsOf(() => applyEdit(draft, corpus, "category:general", cat("general")))).toEqual(["沒有改到任何東西"]);
  });

  it("類型對不上、或這一項不開放修改：擋下", () => {
    expect(problemsOf(() => applyEdit(draft, corpus, "category:general", editableOf(draft, "meta")))).toEqual([
      "修改的類型與項目不符",
    ]);
  });

  it("不會改到傳進來的草稿", () => {
    const before = JSON.stringify(draft);
    applyEdit(draft, corpus, "category:basic-skills", { ...cat("basic-skills"), prefixes: ["外國語文", "英文"] });
    expect(JSON.stringify(draft)).toBe(before);
  });
});

describe("editItem（存檔、紀錄、只重看改到的項目）", () => {
  let tmp: string;
  let store: typeof import("@/lib/review/store");

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "aidit-review-edit-"));
    mkdirSync(join(tmp, "drafts"), { recursive: true });
    copyFileSync(DRAFT, join(tmp, "drafts", "fju-im-111.json"));
    vi.stubEnv("AIDIT_DATA_DIR", tmp);
    vi.resetModules();
    store = await import("@/lib/review/store");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("草稿在打開頁面後被改過：拒絕，免得蓋掉別人的修改", async () => {
    await expect(
      store.editItem({
        packId: "fju-im-111", itemId: "category:basic-skills", draftHash: "stale",
        values: {}, reason: "測試", reviewer: "測試者",
      }),
    ).rejects.toThrow("重新整理");
  });

  it("存成新版草稿、寫修改紀錄；改到的項目回到還沒看，其他保留", async () => {
    const before = (await store.loadDraft("fju-im-111"))!;
    for (const item of before.items) {
      await store.saveDecision("fju-im-111", {
        itemId: item.id, status: "approved", reviewer: "甲", decidedAt: new Date().toISOString(),
      });
    }
    const values = { ...(editableOf(before.draft, "category:basic-skills") as object), prefixes: ["外國語文", "英文"] };
    const r = await store.editItem({
      packId: "fju-im-111", itemId: "category:basic-skills", draftHash: before.draftHash,
      values, reason: "成績單上還有「英文(一)」", reviewer: "乙",
    });
    expect(r.changes).toEqual(["課名開頭：外國語文 → 外國語文、英文"]);

    const after = (await store.loadDraft("fju-im-111"))!;
    const item = after.items.find((i) => i.id === "category:basic-skills")!;
    expect(item.edits).toHaveLength(1);
    expect(item.edits[0]).toMatchObject({ by: "乙", reason: "成績單上還有「英文(一)」" });
    const kept = new Set(after.record.decisions.map((d) => d.itemId));
    expect(kept.has("category:basic-skills")).toBe(false);
    expect(kept.size).toBe(after.items.length - 1);
  });

  it("沒寫原因：拒絕", async () => {
    const v = (await store.loadDraft("fju-im-111"))!;
    await expect(
      store.editItem({
        packId: "fju-im-111", itemId: "category:basic-skills", draftHash: v.draftHash,
        values: editableOf(v.draft, "category:basic-skills"), reason: " ", reviewer: "乙",
      }),
    ).rejects.toThrow("為什麼要改");
  });
});
