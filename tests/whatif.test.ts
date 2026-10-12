import { describe, expect, it } from "vitest";
import { runAudit } from "@/lib/agent/runner";
import { parseIntent } from "@/lib/whatif/intent";
import { simulate } from "@/lib/whatif/simulate";
import { LlmBudget } from "@/lib/llm/client";
import { resolveRulePack } from "@/lib/rules/loader";
import { fixture } from "@/lib/providers/fixtures";
import type { AuditResult } from "@/lib/types";

async function demo(): Promise<{ audit: AuditResult }> {
  const run = await runAudit({ providerKind: "mock", fixture: "demo", currentTerm: "114-2" });
  if (!run.ok) throw new Error("demo 應可完成審查");
  return { audit: run.audit };
}

const ctx = { nextTerm: "115-1", unmetCourses: ["資料探勘與商業智慧（IM4021）"] };

describe("意圖解析", () => {
  it("對應得到情境時輸出結構化 scenario", async () => {
    const r = await parseIntent("我想提前一學期畢業，有可能嗎？", ctx, new LlmBudget());
    expect(r.kind).toBe("scenario");
    if (r.kind === "scenario") expect(r.scenario.type).toBe("early-graduation");
  });

  it("提前畢業沒講學期代號：不填下學期，交給 simulate 照入學年度推（2026-10-12 情境試算頁實測算成下學期畢業）", async () => {
    const r = await parseIntent("我想提前一學期畢業", ctx, new LlmBudget());
    expect(r.kind === "scenario" && r.scenario).toEqual({ type: "early-graduation", targetTerm: "", termsEarly: 1 });
    const y = await parseIntent("我想在 115-1 畢業，提前畢業可以嗎", ctx, new LlmBudget());
    expect(y.kind === "scenario" && y.scenario).toEqual({ type: "early-graduation", targetTerm: "115-1" });
  });

  it("缺少必要參數時回問一個澄清問題，不猜", async () => {
    const r = await parseIntent("我想申請輔系", ctx, new LlmBudget());
    expect(r.kind).toBe("clarify");
  });

  it("對應不到任何情境時明確表示不處理，不自由發揮", async () => {
    const r = await parseIntent("老師人好嗎？這門課會不會當人？", ctx, new LlmBudget());
    expect(r.kind).toBe("out-of-scope");
    if (r.kind === "out-of-scope") expect(r.message).toContain("洽");
  });

  it("意圖解析不得消耗超過 1 次 LLM 呼叫", async () => {
    const budget = new LlmBudget();
    await parseIntent("我想提前一學期畢業", ctx, budget);
    expect(budget.usage.calls).toBeLessThanOrEqual(1);
  });
});

describe("確定性推算", () => {
  it("提前畢業：能補足未修時回報可行並列出具體課程", async () => {
    const { audit } = await demo();
    const pack = resolveRulePack(audit.student);
    if (!pack.ok) throw new Error(pack.detail);
    const r = simulate({
      scenario: { type: "early-graduation", targetTerm: "115-1" },
      audit,
      record: fixture("demo").record,
      pack: pack.pack,
    });
    expect(["feasible", "conditional"]).toContain(r.level);
    expect(r.detail).toMatch(/學分/);
    expect(r.uncountedHolds).toBe(audit.holds.length);
  });

  it("停修：重新計算並回報未修學分的變化", async () => {
    const { audit } = await demo();
    const pack = resolveRulePack(audit.student);
    if (!pack.ok) throw new Error(pack.detail);
    const r = simulate({
      scenario: { type: "withdraw-course", code: "IM4002" },
      audit,
      record: fixture("demo").record,
      pack: pack.pack,
    });
    // 專題研究（二）4 學分停修後，系專業必修由「修課中可滿足」變為未修 4
    expect(r.headline).toContain("4 學分");
    expect(r.detail).toContain("第 23 條");
  });

  it("停修不存在的科目：明確回報查無，不硬算", async () => {
    const { audit } = await demo();
    const pack = resolveRulePack(audit.student);
    if (!pack.ok) throw new Error(pack.detail);
    const r = simulate({
      scenario: { type: "withdraw-course", code: "XX9999" },
      audit,
      record: fixture("demo").record,
      pack: pack.pack,
    });
    expect(r.level).toBe("infeasible");
    expect(r.headline).toContain("查無");
  });

  it("輔系：規定未收錄時不作任何推算", async () => {
    const { audit } = await demo();
    const pack = resolveRulePack(audit.student);
    if (!pack.ok) throw new Error(pack.detail);
    const r = simulate({
      scenario: { type: "add-minor", dept: "機械" },
      audit,
      record: fixture("demo").record,
      pack: pack.pack,
    });
    expect(r.level).toBe("infeasible");
    expect(r.headline).toContain("還沒收錄");
    expect(r.headline + r.detail).not.toMatch(/還差 \d+ 學分|還要修約/);
  });

  it("輔系、雙主修：有收錄規定就照規定逐項算", async () => {
    const { audit } = await demo();
    const pack = resolveRulePack(audit.student);
    if (!pack.ok) throw new Error(pack.detail);
    const r = simulate({ scenario: { type: "double-major", dept: "財金" }, audit, record: fixture("demo").record, pack: pack.pack });
    expect(r.level).toBe("conditional");
    expect(r.headline).toContain("雙主修");
    expect(r.citations.length).toBeGreaterThan(0);
  });

  it("輔系、雙主修、轉系是三件不同的事，不得互相代用", async () => {
    const { audit } = await demo();
    const pack = resolveRulePack(audit.student);
    if (!pack.ok) throw new Error(pack.detail);
    const base = { audit, record: fixture("demo").record, pack: pack.pack };

    // 用一個沒收錄任何規定的系：三種都要各講各的，而且都不給數字
    const minor = simulate({ ...base, scenario: { type: "add-minor", dept: "機械" } });
    const dbl = simulate({ ...base, scenario: { type: "double-major", dept: "機械" } });
    const move = simulate({ ...base, scenario: { type: "change-major", dept: "機械" } });

    expect(minor.headline).toContain("輔系");
    expect(dbl.headline).toContain("雙主修");
    expect(move.headline).toContain("轉系");
    // 三種都不得在沒有規定的情況下給出學分數字
    for (const r of [minor, dbl, move]) expect(r.level).toBe("infeasible");
    // 轉系必須點出「會換掉適用的課程規劃表」這件事
    expect(move.detail).toContain("課程規劃表");
  });

  it("三種情境各自說明需要補齊哪些資料", async () => {
    const { audit } = await demo();
    const pack = resolveRulePack(audit.student);
    if (!pack.ok) throw new Error(pack.detail);
    const base = { audit, record: fixture("demo").record, pack: pack.pack };

    // 沒收錄的系：講學校規定與缺哪份資料，替代路徑指向去索取科目表
    const dbl = simulate({ ...base, scenario: { type: "double-major", dept: "機械" } });
    expect(dbl.detail).toContain("科目表");
    expect(dbl.alternatives.join()).toContain("索取");
    // 有收錄的系：替代路徑是真的另一條路（改修輔系），不是重講規定
    const fn = simulate({ ...base, scenario: { type: "double-major", dept: "財金" } });
    expect(fn.alternatives.join()).toContain("輔系");
    expect(fn.sections?.map((x) => x.title)).toEqual(expect.arrayContaining(["規定", "你的進度"]));
    const move = simulate({ ...base, scenario: { type: "change-major", dept: "財金" } });
    expect(move.alternatives.join()).toContain("採計");
  });

  it("意圖解析分得開輔系、雙主修與轉系", async () => {
    const minor = await parseIntent("申請財金系輔系", ctx, new LlmBudget());
    const dbl = await parseIntent("申請財金系雙主修", ctx, new LlmBudget());
    const move = await parseIntent("我想轉到財金系", ctx, new LlmBudget());
    expect(minor.kind === "scenario" && minor.scenario.type).toBe("add-minor");
    expect(dbl.kind === "scenario" && dbl.scenario.type).toBe("double-major");
    expect(move.kind === "scenario" && move.scenario.type).toBe("change-major");
  });

  it("成績門檻：只回報已確定的數字，明白拒絕預測", async () => {
    const { audit } = await demo();
    const pack = resolveRulePack(audit.student);
    if (!pack.ok) throw new Error(pack.detail);
    const r = simulate({
      scenario: { type: "grade-threshold", target: "研究所甄試" },
      audit,
      record: fixture("demo").record,
      pack: pack.pack,
    });
    expect(r.detail).toContain("不預測");
    expect(r.detail).toMatch(/加權平均為 \d+\.\d\d 分/);
  });
});
