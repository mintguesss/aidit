import { describe, expect, it } from "vitest";
import { parseSlots, clashes, formatSlots, isEarlyMorning } from "@/lib/solver/slots";
import { slotCorpus } from "./fixtures/slot-corpus";

describe("時段解析語料", () => {
  const corpus = slotCorpus();

  it("語料數量達 BACKEND.md §4 要求的 500 筆", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(500);
  });

  it("全數通過，且無法解析者必須標記為 unknown 而非丟棄", () => {
    const failures: string[] = [];
    for (const c of corpus) {
      const r = parseSlots(c.input);
      if (c.expect === "unknown") {
        if (!r.unknown) failures.push(`${JSON.stringify(c.input)} 應為 unknown，實際解析出 ${JSON.stringify(r.slots)}`);
        continue;
      }
      if (r.unknown) {
        failures.push(`${JSON.stringify(c.input)} 不應為 unknown`);
        continue;
      }
      if (JSON.stringify(r.slots) !== JSON.stringify(c.expect)) {
        failures.push(`${JSON.stringify(c.input)} → ${JSON.stringify(r.slots)}，應為 ${JSON.stringify(c.expect)}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures.length).toBe(0);
  });
});

describe("衝堂判定", () => {
  it("同一天節次有交集即為衝堂", () => {
    expect(clashes(parseSlots("五 2-4").slots, parseSlots("五 2-3-4").slots)).toBe(true);
    expect(clashes(parseSlots("五 2-4").slots, parseSlots("五 5-6").slots)).toBe(false);
    expect(clashes(parseSlots("五 2-4").slots, parseSlots("四 2-4").slots)).toBe(false);
  });

  it("時段未知者的 slots 為空，不會被誤判為無衝堂以外的狀態", () => {
    const r = parseSlots("密集課程 詳見系網");
    expect(r.unknown).toBe(true);
    expect(r.slots).toEqual([]);
    expect(clashes(r.slots, parseSlots("五 2-4").slots)).toBe(false);
  });
});

describe("顯示與早八判定", () => {
  it("連續節次以區間顯示，不連續則列舉", () => {
    expect(formatSlots(parseSlots("三 6-8").slots)).toBe("三 6-8");
    expect(formatSlots(parseSlots("三 2,4,6").slots)).toBe("三 2,4,6");
    expect(formatSlots([], true)).toBe("時段未知");
    expect(formatSlots([])).toBe("無上課時間");
  });

  it("含第 1 節即為早八", () => {
    expect(isEarlyMorning(parseSlots("一 1-2").slots)).toBe(true);
    expect(isEarlyMorning(parseSlots("一 2-3").slots)).toBe(false);
  });
});
