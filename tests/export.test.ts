import { describe, it, expect } from "vitest";
import { toCsv, toIcs, TERM_DATES } from "@/lib/plan/export";
import type { Plan } from "@/lib/types";

const plan: Plan = {
  id: "p1",
  preset: "fill-unmet",
  label: "測試方案",
  appliedConstraints: [],
  term: "115-1",
  totalCredits: 5,
  unmetAfter: 0,
  relaxations: [],
  warnings: [],
  courses: [
    {
      code: "IM3001", name: "資料庫系統", credits: 3, slotText: "一 3-4",
      slots: [{ day: 1, periods: [3, 4] }],
      teacher: "王小明, 李大華", category: "major", categoryLabel: "系專業必修",
      remaining: 10,
    },
    {
      // 逗號與分號要被跳脫；時段未知的課不該產生行事曆事件
      code: "GE2002", name: "統計, 機率; 導論", credits: 2, slotText: "時段未定",
      slots: [], teacher: "", category: "ge", categoryLabel: "通識",
      remaining: 5,
    },
  ],
};

describe("學期起訖", () => {
  it("民國轉西元，下學期跨年", () => {
    expect(TERM_DATES.of("115-1")?.start).toBe("2026-09-01");
    expect(TERM_DATES.of("115-2")?.start).toBe("2027-02-15");
  });

  it("格式不對就回 null，不猜", () => {
    expect(TERM_DATES.of("115")).toBeNull();
    expect(TERM_DATES.of("115-3")).toBeNull();
  });
});

describe("CSV", () => {
  const csv = toCsv(plan);

  it("帶 BOM —— 否則 Excel 開起來是亂碼", () => {
    expect(csv.startsWith("\ufeff")).toBe(true);
  });

  it("每個時段一列，時段未知的課仍然列出", () => {
    const rows = csv.trimEnd().split("\r\n");
    expect(rows).toHaveLength(3); // 標頭 + 2 門課
    expect(rows[2]).toContain("時段未定");
  });

  it("含逗號的欄位要加引號", () => {
    expect(csv).toContain('"統計, 機率; 導論"');
  });

  it("節次換算成時間", () => {
    expect(csv).toContain("10:20-12:10"); // 第 3-4 節
  });
});

describe("ICS", () => {
  const ics = toIcs(plan, new Date("2026-09-22T00:00:00Z"));

  it("結構完整", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("時段未知的課不產生事件", () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("DTSTART 落在該星期，且是學期開始後第一次", () => {
    // 2026-09-01 是星期二，所以星期一的第一次是 09-07
    expect(ics).toContain("DTSTART:20260907T102000");
    expect(ics).toContain("DTEND:20260907T121000");
  });

  it("每週重複到學期結束", () => {
    expect(ics).toContain("RRULE:FREQ=WEEKLY;UNTIL=20270104T235959");
  });

  it("逗號與分號依 RFC 5545 跳脫", () => {
    const esc = String.fromCharCode(92);
    expect(ics).toContain(esc + ",");
  });

  it("折行以位元組計 —— 中文一個字 3 bytes，用字元數算會超長", () => {
    const enc = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("把時間資料是合成的這件事寫進檔案", () => {
    expect(ics).toContain("合成資料");
    expect(ics).toContain("以校方公告為準");
  });
});
