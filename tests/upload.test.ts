import { describe, expect, it } from "vitest";
import { UploadProvider, UploadError, parseCsv, parseHtmlTable } from "@/lib/providers/upload";

const student = {
  dept: "IM",
  admissionYear: 111,
  actualAdmissionYear: 111,
  program: "day" as const,
};

const CSV = [
  "學年,學期,課號,科目名稱,學分,選別,成績,狀態,通識領域,開課單位,開課學院",
  "111,1,GC1001,國文（一）,2,必修,88,及格,,GE,GEN",
  "112,2,IM4011,巨量資料分析,3,選修,91,及格,,IM,MGT",
  '114,2,IM4002,"專題研究（二）",4,必修,,修課中,,IM,MGT',
  "113,1,GE1305,生命科學與倫理,2,通識,85,及格,生命探索,GE,GEN",
].join("\n");

describe("CSV 解析", () => {
  it("支援引號跳脫與 CRLF", () => {
    const rows = parseCsv('a,b\r\n"x,1",2\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x,1", "2"],
    ]);
  });

  it("解析校務系統匯出的修課紀錄", async () => {
    const p = new UploadProvider();
    const rec = await p.fetch({ content: CSV, student });
    expect(rec.courses).toHaveLength(4);
    expect(rec.source).toBe("upload");
    expect(rec.courses[0]).toMatchObject({ code: "GC1001", credits: 2, selectType: "required", status: "passed" });
    expect(rec.courses[2]).toMatchObject({ code: "IM4002", status: "in_progress", score: null });
    expect(rec.courses[3]).toMatchObject({ generalDomain: "生命探索", selectType: "general" });
  });

  it("匯出檔不含學號與姓名：產生的代號不得回寫任何識別資訊", async () => {
    const p = new UploadProvider();
    const rec = await p.fetch({ content: CSV, student });
    expect(rec.student.id.startsWith("S-UPLOAD-")).toBe(true);
    expect(rec.student.displayName).toBeUndefined();
  });

  it("缺少必要欄位時明確指出缺哪些，不做補值猜測", async () => {
    const p = new UploadProvider();
    await expect(
      p.fetch({ content: "課號,科目名稱\nGC1001,國文（一）", student }),
    ).rejects.toThrow(UploadError);
  });

  it("欄位無法解析時指出行號", async () => {
    const bad = ["學年,學期,課號,科目名稱,學分,選別", "111,X,GC1001,國文,2,必修"].join("\n");
    await expect(new UploadProvider().fetch({ content: bad, student })).rejects.toThrow(/第 2 列/);
  });

  it("capabilities 依實際內容回報，缺項會讓上層轉人工而非猜測", async () => {
    const p = new UploadProvider();
    await p.fetch({ content: CSV, student });
    const cap = p.capabilities();
    expect(cap.hasEnrollment).toBe(true);
    expect(cap.hasWaivers).toBe(false);
    expect(cap.hasGraduationEvidence).toBe(false);
  });
});

describe("HTML 表格解析", () => {
  it("取第一個 table 並去除標籤", () => {
    const html = `
      <html><body><table>
        <tr><th>學年</th><th>學期</th><th>課號</th><th>科目名稱</th><th>學分</th><th>選別</th></tr>
        <tr><td>111</td><td>1</td><td>GC1001</td><td>國文（一）</td><td>2</td><td>必修</td></tr>
      </table></body></html>`;
    const rows = parseHtmlTable(html);
    expect(rows[0]).toContain("課號");
    expect(rows[1]).toEqual(["111", "1", "GC1001", "國文（一）", "2", "必修"]);
  });

  it("查無 table 時明確報錯", () => {
    expect(() => parseHtmlTable("<html><body>沒有表格</body></html>")).toThrow(UploadError);
  });
});
