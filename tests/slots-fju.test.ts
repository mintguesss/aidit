import { describe, it, expect } from "vitest";
import { parseSlots, isEarlyMorning } from "@/lib/solver/slots";
import { FJU_PERIODS, fjuPeriodIndex, fjuPeriodByIndex } from "@/lib/offerings/periods-fju";

/**
 * 輔仁大學的節次代號（D0–D8、DN、E0–E4）。
 * 映射到系統整數節次後，對話層的「早上 1–4、下午 5–9、晚上 10–15」直接成立。
 */

describe("輔大節次表", () => {
  it("十五個節次，內部編號連續且不重複", () => {
    expect(FJU_PERIODS.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("時間照教務處原文", () => {
    expect(fjuPeriodByIndex(3)).toMatchObject({ code: "D3", start: "10:10", end: "11:00" });
    expect(fjuPeriodByIndex(5)).toMatchObject({ code: "DN", start: "12:40", end: "13:30" });
    expect(fjuPeriodByIndex(10)).toMatchObject({ code: "E0", start: "17:40", end: "18:30" });
  });

  it("內部編號不等於節次名稱：內部 6 是 D5", () => {
    expect(fjuPeriodIndex("D5")).toBe(6);
    expect(fjuPeriodIndex("d5")).toBe(6);
    expect(fjuPeriodIndex("X9")).toBeUndefined();
  });

  it("時段落在對話層定義的區間裡", () => {
    const at = (c: string) => fjuPeriodIndex(c)!;
    for (const c of ["D1", "D2", "D3", "D4"]) expect(at(c)).toBeGreaterThanOrEqual(1), expect(at(c)).toBeLessThanOrEqual(4);
    for (const c of ["DN", "D5", "D6", "D7", "D8"]) expect(at(c)).toBeGreaterThanOrEqual(5), expect(at(c)).toBeLessThanOrEqual(9);
    for (const c of ["E0", "E1", "E2", "E3", "E4"]) expect(at(c)).toBeGreaterThanOrEqual(10);
  });
});

describe("解析輔大的時段字串", () => {
  it("區間：D2-D4", () => {
    expect(parseSlots("二 D2-D4").slots).toEqual([{ day: 2, periods: [2, 3, 4] }]);
  });

  it("特午節 DN", () => {
    expect(parseSlots("四 DN").slots).toEqual([{ day: 4, periods: [5] }]);
  });

  it("下午：D5-D6 是內部 6、7", () => {
    expect(parseSlots("五 D5-D6").slots).toEqual([{ day: 5, periods: [6, 7] }]);
  });

  it("晚上：E0-E2", () => {
    expect(parseSlots("一 E0-E2").slots).toEqual([{ day: 1, periods: [10, 11, 12] }]);
  });

  it("兩個時段", () => {
    expect(parseSlots("二 D2-D4 / 四 D7-D8").slots).toEqual([
      { day: 2, periods: [2, 3, 4] },
      { day: 4, periods: [8, 9] },
    ]);
  });

  it("看不懂的代碼整筆標為未知，不輸出片段時段", () => {
    const r = parseSlots("二 D9");
    expect(r.unknown).toBe(true);
    expect(r.slots).toEqual([]);
  });
});

describe("合成資料的寫法不受影響", () => {
  it("數字節次", () => {
    expect(parseSlots("二 3-4,5").slots).toEqual([{ day: 2, periods: [3, 4, 5] }]);
  });

  it("單一字母的夜間代號 A–E 仍是 11–15", () => {
    expect(parseSlots("一 A,B").slots).toEqual([{ day: 1, periods: [11, 12] }]);
    expect(parseSlots("三 E").slots).toEqual([{ day: 3, periods: [15] }]);
  });
});

describe("早八", () => {
  it("輔大特早節（07:10）比早八還早，同樣算早八", () => {
    expect(isEarlyMorning(parseSlots("二 D0").slots)).toBe(true);
    expect(isEarlyMorning(parseSlots("二 D1-D2").slots)).toBe(true);
    expect(isEarlyMorning(parseSlots("二 D2-D3").slots)).toBe(false);
  });
});
