import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { zRulePack } from "@/lib/rules/schema";
import { categoriesFor, offeringsFor } from "@/lib/offerings";

/**
 * 開課資料的可採計類別在排課時依學生的規則包判斷（TODO H10）。
 * 以前是轉換時照某一版規則寫死，規則改版（v0.6 → v0.7）或換別的系，開課資料就對不上 ——
 * 實際發生過：線上用鎖版的 v0.6，開課資料是照 v0.7 產的，排課說「本系專業選修找不到課」。
 */

const draft = JSON.parse(readFileSync("tests/fixtures/rulepacks/fju-im-111.draft.json", "utf8")) as Record<string, unknown>;
const v07 = zRulePack.parse({ ...draft, provenance: "approved", approvedBy: "測試" });

// v0.6 的結構：本系專業選修 10、其他選修 22 兩個類別
type Cat = { id: string; subRules?: { citation: object }[] };
const cats = draft.categories as Cat[];
const free = cats.find((c) => c.id === "free-elective")!;
const { subRules: _s, ...freeRest } = free;
const v06 = zRulePack.parse({
  ...draft,
  provenance: "approved",
  approvedBy: "測試",
  categories: [
    ...cats.filter((c) => c.id !== "free-elective"),
    { id: "major-elective", name: "本系專業選修", shortName: "系專選修", credits: 10, order: 5,
      match: { type: "deptElective", dept: "IM" }, citation: free.subRules![0]!.citation },
    { ...freeRest, credits: 22, order: 6 },
  ],
});

describe("開課資料的類別依規則包即時判斷", () => {
  const all = [111, 112, 113, 114, 115].flatMap((y) => [1, 2].flatMap((t) => offeringsFor(y, t as 1 | 2, "fju")));

  it("每一班都有選別", () => {
    expect(all.length).toBeGreaterThan(3000);
    expect(all.every((o) => o.selectType)).toBe(true);
  });

  it("依 v0.7 判斷的類別，與轉換腳本照 v0.7 寫下的一致（同一套判斷）", () => {
    for (const o of all) expect([...categoriesFor(o, v07)].sort(), `${o.code} ${o.name}`).toEqual([...o.category].sort());
  });

  it("換成 v0.6 的切分結構：本系選修同時算系專選與其他選修，不用重產開課資料", () => {
    const t = offeringsFor(113, 1, "fju", v06);
    const db = t.find((o) => o.name === "企業資源規劃")!;
    expect(db.category.sort()).toEqual(["free-elective", "major-elective"]);
    expect(t.find((o) => o.code === "01558")!.category).toEqual(["dept-required"]);
  });

  it("通識只算通識（超修不計的類別具排他性），不會流到選修", () => {
    const g = offeringsFor(113, 1, "fju", v07).filter((o) => o.selectType === "general");
    expect(g.length).toBeGreaterThan(50);
    expect(g.every((o) => o.category.length === 1 && o.category[0] === "general")).toBe(true);
  });
});
