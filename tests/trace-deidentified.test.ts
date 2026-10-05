import { describe, it, expect } from "vitest";
import { runAudit } from "@/lib/agent/runner";
import { FIXTURES } from "@/lib/providers/fixtures";

/**
 * 執行期的去識別（TODO E8）。CI 第 6 項掃的是原始碼；這裡驗證**實際產生的執行紀錄**
 * 不含學生代號、姓名、遮蔽學號、班級（SPEC §9：trace 只存去識別後的內容，學生以 studentHash 表示）。
 */
describe("執行紀錄不含可識別欄位", () => {
  for (const f of FIXTURES.filter((x) => (x.record.student.school ?? "demo") === "demo").slice(0, 4)) {
    it(f.id, async () => {
      const run = await runAudit({ providerKind: "mock", fixture: f.id, currentTerm: f.term ?? "114-2" });
      const text = JSON.stringify(run.trace);
      const s = f.record.student;
      for (const v of [s.id, s.displayName, s.maskedId, s.className].filter((x): x is string => Boolean(x))) {
        expect(text, `trace 含有「${v}」`).not.toContain(v);
      }
    });
  }
});
