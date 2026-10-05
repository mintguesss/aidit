import { describe, it, expect, afterEach } from "vitest";
import { offeringsFor, rawOfferings, setPublishedOfferings, type RawOffering } from "@/lib/offerings";

/**
 * 資料庫裡的開課資料與 repo 版本合併（lib/offerings/index.ts）。
 * 同一學期以資料庫為準、整學期取代；資料庫沒有的學期照用 repo 的。
 */

const row = (code: string, year: number, term: 1 | 2): RawOffering => ({
  school: "fju", code, name: `測試課 ${code}`, credits: 3, year, term, teacher: "測試",
  slotText: "二 D3-D4", dept: "IM", college: "MGT", category: ["free-elective"], fetchedAt: "2026-10-05T00:00:00+08:00",
});

afterEach(() => setPublishedOfferings([]));

describe("資料庫開課資料", () => {
  it("沒有資料庫版本時就是 repo 版本", () => {
    expect(offeringsFor(115, 1, "fju").length).toBeGreaterThan(600);
  });

  it("同一學期以資料庫為準，整學期取代（不是逐班合併）", () => {
    setPublishedOfferings([row("99001", 115, 1)]);
    const t = offeringsFor(115, 1, "fju");
    expect(t.map((o) => o.code)).toEqual(["99001"]);
  });

  it("資料庫沒有的學期照用 repo 的；新學期只在資料庫也看得到", () => {
    setPublishedOfferings([row("99002", 116, 1)]);
    expect(offeringsFor(113, 1, "fju").length).toBeGreaterThan(600);
    expect(offeringsFor(116, 1, "fju").map((o) => o.code)).toEqual(["99002"]);
  });

  it("別校同學期不受影響：合成資料的 115-1 照舊", () => {
    const before = offeringsFor(115, 1).length;
    setPublishedOfferings([row("99001", 115, 1)]);
    expect(offeringsFor(115, 1).length).toBe(before);
    expect(rawOfferings().some((r) => r.code === "99001")).toBe(true);
  });
});
