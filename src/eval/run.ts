// 必須排在其他 import 之前：下面的模組在載入時就會讀 process.env
import "@/lib/util/env";
import { MODEL_LABEL } from "@/lib/llm/client";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runAudit } from "@/lib/agent/runner";
import { auditCredits } from "@/lib/audit/engine";
import { resolveRulePack } from "@/lib/rules/loader";
import { activeCourseCodes } from "@/lib/offerings";
import { GOLDEN_CASES, type CategoryExpectation } from "./golden/cases";
import { generatedCases } from "./golden/generated";
import { fixedWorkflow, ourOutcome, singleLlmAvailable } from "./baselines";
import { fixture } from "@/lib/providers/fixtures";
import type { AuditResult } from "@/lib/types";

/**
 * 評測執行器（SPEC.md §10）。
 *
 * 產出附件二要求的指標：正確率、成功率、平均與最大延遲、每次成本、
 * 工具調用成功率、重試次數、人工介入率、中止率、錯誤分類。
 * 注入測試另見 src/eval/injection/run.ts。
 */

type CaseResult = {
  id: string;
  source: "manual" | "generated";
  tests: string;
  ok: boolean;
  /** 錯答：給了數字但數字錯了 */
  wrongAnswer: boolean;
  /** 中止／轉人工 */
  abstained: boolean;
  diffs: string[];
  ms: number;
  toolCalls: number;
  toolFailures: number;
  retries: number;
  holds: number;
  llmCalls: number;
  costUsd: number;
  status: string;
};

async function main() {
  const results: CaseResult[] = [];
  const baselineRows: string[] = [];

  // ---- 人工標準答案（走完整 agent 流程，與正式使用相同的程式路徑）----
  for (const c of GOLDEN_CASES) {
    const t0 = Date.now();
    const run = await runAudit({ providerKind: "mock", fixture: c.fixture, currentTerm: "114-2" });
    const ms = Date.now() - t0;
    const toolCalls = run.trace.steps.reduce((a, s) => a + s.toolCalls.length, 0);
    const toolFailures = run.trace.steps.reduce(
      (a, s) => a + s.toolCalls.filter((x) => x.status === "failed").length,
      0,
    );
    const retries = run.trace.steps.reduce((a, s) => a + s.retries, 0);

    const base = {
      id: c.fixture,
      source: "manual" as const,
      tests: c.tests,
      ms,
      toolCalls,
      toolFailures,
      retries,
      llmCalls: run.trace.llm.calls,
      costUsd: run.trace.llm.costUsd,
      status: run.trace.status,
    };

    if (c.expectAllHold) {
      const passed = !run.ok && run.error.kind === "all-hold";
      results.push({
        ...base,
        ok: passed,
        wrongAnswer: run.ok,
        abstained: !run.ok,
        holds: 0,
        diffs: passed ? [] : ["預期整案轉人工，實際卻輸出了判定結果"],
      });
      continue;
    }

    if (!run.ok) {
      results.push({
        ...base,
        ok: false,
        wrongAnswer: false,
        abstained: true,
        holds: 0,
        diffs: [`預期輸出判定結果，實際中止：${run.error.reason}`],
      });
      continue;
    }

    const diffs = compare(run.audit, c.expect!);
    results.push({
      ...base,
      ok: diffs.length === 0,
      wrongAnswer: diffs.length > 0,
      abstained: false,
      holds: run.audit.holds.length,
      diffs,
    });

    // 基準比較只在有標準答案的案例上做
    const pack = resolveRulePack(run.audit.student);
    if (pack.ok) {
      const rec = fixture(c.fixture).record;
      const greedy = fixedWorkflow(rec, pack.pack);
      const ours = ourOutcome(run.audit);
      const expectedUnmet = c.expect!.unmet;
      baselineRows.push(
        [
          c.fixture.padEnd(24),
          `標準答案 ${String(expectedUnmet).padStart(3)}`,
          `本系統 ${String(ours.totalUnmet).padStart(3)}${ours.totalUnmet === expectedUnmet ? " ✓" : " ✗"}`,
          `固定workflow ${String(greedy.totalUnmet).padStart(3)}${greedy.totalUnmet === expectedUnmet ? " ✓" : " ✗"}`,
          `轉人工 本系統 ${ours.abstained} / 固定workflow ${greedy.abstained}`,
        ].join("  "),
      );
    }
  }

  // ---- 程式生成案例（無歧義，標準答案由獨立參考實作計算）----
  const packLookup = resolveRulePack(generatedCases()[0]!.record.student);
  if (!packLookup.ok) throw new Error(`規則包載入失敗：${packLookup.detail}`);

  for (const g of generatedCases()) {
    const t0 = Date.now();
    const audit = auditCredits({
      record: g.record,
      pack: packLookup.pack,
      traceId: `eval-${g.id}`,
      currentTerm: "114-2",
      nextTerm: "115-1",
      activeCourseCodes: activeCourseCodes(),
    });
    const diffs = compare(audit, g.expect);
    results.push({
      id: g.id,
      source: "generated",
      tests: g.tests,
      ok: diffs.length === 0,
      wrongAnswer: diffs.length > 0,
      abstained: false,
      diffs,
      ms: Date.now() - t0,
      toolCalls: 1,
      toolFailures: 0,
      retries: 0,
      holds: audit.holds.length,
      llmCalls: 0,
      costUsd: 0,
      status: "ok",
    });
  }

  report(results, baselineRows);
}

function compare(
  audit: AuditResult,
  e: {
    totalEarned: number;
    countable: number;
    inProgress: number;
    unmet: number;
    overflow: number;
    holds?: number;
    categories: CategoryExpectation[];
  },
): string[] {
  const diffs: string[] = [];
  const eq = (label: string, got: number, want: number) => {
    if (got !== want) diffs.push(`${label}：得 ${got}，應為 ${want}`);
  };
  eq("totalEarned", audit.totalEarned, e.totalEarned);
  eq("countable", audit.countable, e.countable);
  eq("inProgress", audit.inProgress, e.inProgress);
  eq("unmet", audit.unmet, e.unmet);
  eq("overflow", audit.overflow, e.overflow);
  if (e.holds !== undefined) eq("holds", audit.holds.length, e.holds);

  for (const ce of e.categories) {
    const got = audit.categories.find((c) => c.id === ce.id);
    if (!got) {
      diffs.push(`類別 ${ce.id} 不存在於結果中`);
      continue;
    }
    eq(`${ce.id}.earned`, got.earned, ce.earned);
    eq(`${ce.id}.inProgress`, got.inProgress, ce.inProgress);
    eq(`${ce.id}.unmet`, got.unmet, ce.unmet);
    eq(`${ce.id}.overflow`, got.overflow, ce.overflow);
    if (got.status !== ce.status) diffs.push(`${ce.id}.status：得 ${got.status}，應為 ${ce.status}`);
  }

  // 不變式也在評測層再驗一次
  if (audit.countable + audit.inProgress + audit.unmet !== audit.minCredits) {
    diffs.push("不變式失效：countable + inProgress + unmet !== minCredits");
  }
  if (audit.totalEarned !== audit.countable + audit.overflow) {
    diffs.push("不變式失效：totalEarned !== countable + overflow");
  }
  return diffs;
}

function report(results: CaseResult[], baselineRows: string[]) {
  const n = results.length;
  const passed = results.filter((r) => r.ok).length;
  const wrong = results.filter((r) => r.wrongAnswer).length;
  const abstained = results.filter((r) => r.abstained).length;
  const withHolds = results.filter((r) => r.holds > 0).length;
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const toolCalls = results.reduce((a, r) => a + r.toolCalls, 0);
  const toolFailures = results.reduce((a, r) => a + r.toolFailures, 0);
  const retries = results.reduce((a, r) => a + r.retries, 0);
  const cost = results.reduce((a, r) => a + r.costUsd, 0);
  const llmCalls = results.reduce((a, r) => a + r.llmCalls, 0);

  const pct = (x: number, d = n) => `${((x / d) * 100).toFixed(1)}%`;
  const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))] ?? 0;

  const lines: string[] = [];
  lines.push("Aidit 評測報告");
  lines.push(`產生時間　${new Date().toISOString()}`);
  lines.push(`執行模式　${singleLlmAvailable() ? "真實模型" : "離線（規則解消使用確定性替身）"}`);
  // 不同模型的數字不能放在同一張比較表上，所以報告一定要標明是誰跑的
  lines.push(`模型　　　${singleLlmAvailable() ? MODEL_LABEL : "—"}`);
  lines.push("");
  lines.push("── 指標（對應競賽附件二）──────────────────────");
  lines.push(`案例數　　　　　${n}（人工標準答案 ${results.filter((r) => r.source === "manual").length}、程式生成 ${results.filter((r) => r.source === "generated").length}）`);
  lines.push(`正確率　　　　　${pct(passed)}（${passed}/${n}）`);
  lines.push(`錯答率　　　　　${pct(wrong)}（${wrong}/${n}）　← 本系統的首要優化目標為 0`);
  lines.push(`中止／轉人工率　${pct(abstained)}（${abstained}/${n}）`);
  lines.push(`含待確認事項之案例　${pct(withHolds)}（${withHolds}/${n}）`);
  lines.push(`平均延遲　　　　${(ms.reduce((a, b) => a + b, 0) / n).toFixed(0)}ms`);
  lines.push(`P50 / P95 延遲　${p(0.5)}ms / ${p(0.95)}ms`);
  lines.push(`最大延遲　　　　${ms[ms.length - 1]}ms`);
  lines.push(`工具調用　　　　${toolCalls} 次，失敗 ${toolFailures} 次（成功率 ${pct(toolCalls - toolFailures, toolCalls)}）`);
  lines.push(`重試次數　　　　${retries}`);
  lines.push(`LLM 呼叫　　　　${llmCalls} 次，總成本 US$${cost.toFixed(6)}，平均每案 US$${(cost / n).toFixed(6)}`);
  lines.push("");

  const failures = results.filter((r) => !r.ok);
  lines.push("── 錯誤分類 ──────────────────────────────────");
  if (failures.length === 0) {
    lines.push("無失敗案例。");
  } else {
    for (const f of failures) {
      lines.push(`[${f.id}] ${f.tests}`);
      for (const d of f.diffs) lines.push(`    - ${d}`);
    }
  }
  lines.push("");

  lines.push("── 基準比較：未修學分（本系統 vs 固定 workflow）──");
  lines.push("固定 workflow ＝ 貪婪指派、不檢索補充依據、不處理規則缺口，一律作答。");
  for (const r of baselineRows) lines.push(r);
  lines.push("");
  lines.push("基準 A（人工計算）：由同學對照規劃表自行計算，耗時與錯誤率須以紙本實測填入 eval/manual-baseline.md。");
  lines.push(
    singleLlmAvailable()
      ? "基準 C（單次 LLM）：可執行，請以 --with-llm 另行啟動（本次未執行以免產生非預期費用）。"
      : "基準 C（單次 LLM）：未執行 —— 未設定 ANTHROPIC_API_KEY。報告中不填入未實測的數字。",
  );
  lines.push("");
  lines.push("── 核心論述 ──────────────────────────────────");
  lines.push("在畢業審查場域，答錯的代價遠高於不答：一個假的「未修 12 學分」會讓已能畢業的學生多讀一學期。");
  lines.push("本系統以零錯答為優化目標，接受較高的轉人工率；上表的『轉人工』欄即為這個取捨的代價。");

  const out = lines.join("\n");
  console.log(out);

  const dir = join(process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "eval-report.txt"), out, "utf8");
  writeFileSync(join(dir, "eval-report.json"), JSON.stringify({ results }, null, 2), "utf8");
  console.log(`\n報告已寫入 .data/eval-report.txt 與 .data/eval-report.json`);

  if (wrong > 0) {
    console.error(`\n評測失敗：出現 ${wrong} 件錯答。`);
    process.exit(1);
  }
}

void main();
