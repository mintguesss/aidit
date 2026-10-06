import { describe, it, expect } from "vitest";
import { classAllows, classProfileOf, sectionLetter } from "@/lib/offerings/class-group";

/** 開課班級：這一班開給誰（TODO C7）。寫法照輔大 111-2～115-1 的實際資料 */
const im = classProfileOf({ dept: "IM" }, "MGT");

describe("開課班級", () => {
  it("開給某一系的全人課：資管的可以，別系的不行（有沒有寫「系」「組」都認得）", () => {
    expect(classAllows("資管系專倫", im).ok).toBe(true);
    expect(classAllows("資管系人哲", im).ok).toBe(true);
    for (const g of ["中文系專倫", "行銷組專倫", "企管專倫", "金融國企專倫", "智慧資安人哲"]) {
      expect(classAllows(g, im).ok, g).toBe(false);
    }
  });

  it("國文外文依學院：管理學院的可以，別的學院不行；大二英文、非英文全校開放", () => {
    expect(classAllows("CT-管理學院", im).ok).toBe(true);
    expect(classAllows("FT-理工學院", im).ok).toBe(false);
    expect(classAllows("FT-大二英文", im).ok).toBe(true);
    expect(classAllows("FT-非英文", im).ok).toBe(true);
  });

  it("甲乙班：知道學生是甲班才排除乙班；不知道就都可以（排課讓整份課表同一班）", () => {
    expect(classAllows("資管二乙", im).ok).toBe(true);
    const a = classProfileOf({ dept: "IM", classSection: "甲" }, "MGT");
    expect(classAllows("資管二乙", a).ok).toBe(false);
    expect(classAllows("資管二甲", a).ok).toBe(true);
    expect(sectionLetter("資管二乙", im)).toBe("乙");
    expect(sectionLetter("資管三", im)).toBeUndefined();
  });

  it("看不懂的寫法、沒有開課班級：當成開放，不因為猜錯排除能修的課", () => {
    expect(classAllows("全人教育課程中心", im).ok).toBe(true);
    expect(classAllows(undefined, im).ok).toBe(true);
  });
});
