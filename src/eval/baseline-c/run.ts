// 順序有意義：guard 要在任何讀環境變數的模組之前
import { LIVE } from "./guard";
import "@/lib/util/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LlmBudget, MODEL_LABEL, llmAvailable, structured } from "@/lib/llm/client";
import { runAudit } from "@/lib/agent/runner";
import { loadCorpus, preloadPublishedRules, resolveRulePack } from "@/lib/rules/loader";
import { preloadOfferings } from "@/lib/offerings/published";
import { announcementsFor } from "@/lib/rules/announcements";
import { fixture } from "@/lib/providers/fixtures";
import type { AuditResult } from "@/lib/types";
import { REAL_CASES, type GraduationVerdict, type RealCase } from "./cases";
import {
  BASELINE_SYSTEM,
  buildBaselineUser,
  offlineBaselineAnswer,
  zBaselineAnswer,
  type BaselineAnswer,
  type SourceDoc,
} from "./prompt";
import { consistency, scoreRun, type RunScore } from "./score";

/**
 * 基準 C（docs/SPEC.md §10）：本系統 vs. 單次 LLM，同一個模型、同一批真實案例。
 *
 *   npm run eval:baseline-c                 離線替身，只驗證流程，不呼叫模型
 *   npm run eval:baseline-c -- --live       呼叫 .env 設定的模型（會花錢）
 *   選項：--runs 3（每題次數）、--case fju-im-111-year2（只跑一題）
 *
 * 報告寫到 .data/baseline-c-report.txt／.json。
 */

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const RUNS = Number(arg("--runs") ?? 3);
const ONLY = arg("--case");
/** 對照組給高一點的推理強度，避免被說是故意壓低它 */
const EFFORT = "high" as const;
const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 180_000;

type BaselineRun = {
  answer: BaselineAnswer | null;
  error?: string;
  score: RunScore | null;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

type CaseReport = {
  fixture: string;
  label: string;
  ours: { score: RunScore; ms: number; llmCalls: number; costUsd: number } | { error: string };
  baseline: BaselineRun[];
  consistent: boolean;
  distinct: number;
};

/** 把我們的審查結果轉成同一個形狀，用同一套評分 */
function ourAnswer(audit: AuditResult): BaselineAnswer {
  const missing = audit.categories
    .flatMap((c) => c.subRules.map((s) => /尚缺\s*(.+?)\s*領域/.exec(s.detail)?.[1] ?? ""))
    .filter(Boolean)
    .flatMap((s) => s.split(/[、，,]/).map((x) => x.trim()));
  const checksOpen = (audit.graduationChecks ?? []).some((g) => g.status !== "satisfied");
  const canGraduate: GraduationVerdict =
    audit.unmet > 0 ? "no" : checksOpen || audit.holds.length > 0 ? "needs-review" : "yes";
  return {
    categories: audit.categories.map((c) => ({ name: c.name, earned: c.earned, unmet: c.unmet, needsReview: false, reason: null })),
    totalUnmet: audit.unmet,
    missingGenEdDomains: missing,
    canGraduate,
    holds: audit.holds.map((h) => ({ item: h.title, reason: h.body })),
    // 我們的引文在審查流程裡已逐條回查（verifyCitations 步驟），這裡不重複計
    citations: [],
  };
}

function sourcesFor(c: RealCase, corpus: Map<string, string>): { docs: SourceDoc[]; categoryNames: string[] } {
  const record = fixture(c.fixture).record;
  const pack = resolveRulePack(record.student);
  if (!pack.ok) throw new Error(`${c.fixture} 找不到規則包（要接 Supabase）：${pack.detail}`);

  const docs: SourceDoc[] = [];
  for (const d of pack.pack.documents) {
    const text = corpus.get(d.id);
    if (!text) throw new Error(`語料缺 ${d.id}`);
    docs.push({ id: d.id, title: d.title, text });
  }
  // 公告：跟引擎看到的範圍一樣（同校、全校或本系）。適不適用讓模型自己判斷
  const seen = new Set<string>();
  for (const a of announcementsFor(pack.pack.school)) {
    if (a.dept && a.dept !== record.student.dept) continue;
    if (seen.has(a.contentDocId)) continue;
    const text = corpus.get(a.contentDocId);
    if (!text) continue;
    seen.add(a.contentDocId);
    // 一份公告原文常拆成好幾則判斷（新制、舊制），標題用原文自己的第一行，不掛其中一則的標題
    const title = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? a.contentDocId;
    docs.push({ id: a.contentDocId, title, text });
  }
  return { docs, categoryNames: pack.pack.categories.map((x) => x.name) };
}

async function runBaseline(c: RealCase, corpus: Map<string, string>): Promise<BaselineRun> {
  const record = fixture(c.fixture).record;
  const { docs, categoryNames } = sourcesFor(c, corpus);
  const t0 = Date.now();
  try {
    const res = await structured(
      {
        system: BASELINE_SYSTEM,
        user: buildBaselineUser(record, c.through, categoryNames, docs),
        schema: zBaselineAnswer,
        offline: () => offlineBaselineAnswer(categoryNames),
        effort: EFFORT,
        maxTokens: MAX_TOKENS,
        timeoutMs: TIMEOUT_MS,
      },
      new LlmBudget(2),
    );
    return {
      answer: res.data,
      score: scoreRun(res.data, c, corpus),
      ms: Date.now() - t0,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: res.costUsd,
    };
  } catch (e) {
    // 呼叫兩次都失敗（逾時、格式不合）也照實記下來：對照組沒給答案，算轉人工
    return { answer: null, error: String(e), score: null, ms: Date.now() - t0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
}

async function runOurs(c: RealCase, corpus: Map<string, string>): Promise<CaseReport["ours"]> {
  const t0 = Date.now();
  const run = await runAudit({ providerKind: "mock", fixture: c.fixture, currentTerm: c.through });
  if (!run.ok) return { error: run.error.reason };
  return {
    score: scoreRun(ourAnswer(run.audit), c, corpus),
    ms: Date.now() - t0,
    llmCalls: run.trace.llm.calls,
    costUsd: run.trace.llm.costUsd,
  };
}

async function main() {
  if (LIVE && !llmAvailable()) throw new Error("加了 --live 但沒有設定模型（.env 的 ANTHROPIC_API_KEY）。");
  await Promise.all([preloadPublishedRules(), preloadOfferings()]);
  const corpus = loadCorpus();
  const cases = REAL_CASES.filter((c) => !ONLY || c.fixture === ONLY);
  if (cases.length === 0) throw new Error(`沒有案例 ${ONLY}`);

  const reports: CaseReport[] = [];
  for (const c of cases) {
    process.stdout.write(`${c.fixture} `);
    const ours = await runOurs(c, corpus);
    const baseline: BaselineRun[] = [];
    for (let i = 0; i < RUNS; i++) {
      baseline.push(await runBaseline(c, corpus));
      process.stdout.write(".");
    }
    const answered = baseline.flatMap((b) => (b.answer ? [b.answer] : []));
    const { consistent, distinct } = consistency(answered);
    reports.push({ fixture: c.fixture, label: c.label, ours, baseline, consistent: consistent && answered.length === baseline.length, distinct });
    process.stdout.write("\n");
  }

  const text = render(reports);
  mkdirSync(".data", { recursive: true });
  writeFileSync(join(".data", "baseline-c-report.txt"), text);
  writeFileSync(join(".data", "baseline-c-report.json"), JSON.stringify({ model: MODEL_LABEL, live: LIVE, runs: RUNS, reports }, null, 2));
  console.log("\n" + text);
}

function render(reports: CaseReport[]): string {
  const L: string[] = [];
  L.push(`# 基準 C：本系統 vs. 單次 LLM（${new Date().toISOString().slice(0, 10)}）`);
  L.push(`模型：${MODEL_LABEL}　模式：${LIVE ? "實際呼叫模型" : "離線替身"}　每題 ${RUNS} 次　對照組推理強度 ${EFFORT}`);
  if (!LIVE) L.push("**離線替身：對照組的結果是固定的「全部轉人工」，只用來驗證流程，數字不代表模型表現，不得引用。**");
  L.push("案例：同一份真實成績單（輔大資管 111）截至五個時間點；不是五位獨立的學生。");
  L.push("");

  const all = reports.flatMap((r) => r.baseline);
  const n = (o: string) => all.filter((b) => (b.score?.outcome ?? "abstain") === o).length;
  const falseGrad = all.filter((b) => b.score?.canGraduate.falseGraduate).length;
  const cites = all.reduce((a, b) => a + (b.score?.citations.total ?? 0), 0);
  const citesBad = all.reduce((a, b) => a + (b.score?.citations.failed.length ?? 0), 0);
  const oursWrong = reports.filter((r) => "score" in r.ours && r.ours.score.outcome === "wrong").length;
  const cost = all.reduce((a, b) => a + b.costUsd, 0);
  const avgMs = all.length ? Math.round(all.reduce((a, b) => a + b.ms, 0) / all.length) : 0;

  L.push("## 總覽");
  L.push(`本系統：${reports.length} 題，錯答 ${oursWrong}`);
  L.push(`單次 LLM：${all.length} 次，答對 ${n("correct")}、錯答 ${n("wrong")}、轉人工 ${n("abstain")}；誤判可畢業 ${falseGrad}`);
  L.push(`單次 LLM 引文：${cites} 句，原文找不到 ${citesBad} 句`);
  L.push(`單次 LLM 同題多次答案一致：${reports.filter((r) => r.consistent).length}/${reports.length} 題`);
  L.push(`單次 LLM 平均延遲 ${(avgMs / 1000).toFixed(1)} 秒，總成本 US$${cost.toFixed(4)}`);
  L.push("");

  for (const r of reports) {
    L.push(`## ${r.label}（${r.fixture}）`);
    if ("error" in r.ours) L.push(`本系統：中止 ${r.ours.error}`);
    else {
      const s = r.ours.score;
      L.push(`本系統：${s.outcome}　合計還差 ${s.totalUnmet.got}（標準 ${s.totalUnmet.expected}）　${r.ours.ms} ms　模型 ${r.ours.llmCalls} 次`);
      for (const e of s.errors) L.push(`  ✗ ${e}`);
    }
    r.baseline.forEach((b, i) => {
      if (!b.score) {
        L.push(`單次 LLM #${i + 1}：沒有答案（${b.error}）`);
        return;
      }
      const s = b.score;
      const cats = s.categories.map((x) => `${x.name.slice(0, 4)} ${x.got ?? "?"}`).join("、");
      L.push(
        `單次 LLM #${i + 1}：${s.outcome}　合計 ${s.totalUnmet.got ?? "?"}　能否畢業 ${s.canGraduate.got}　` +
          `引文 ${s.citations.verified}/${s.citations.total}　${(b.ms / 1000).toFixed(1)} 秒　US$${b.costUsd.toFixed(4)}`,
      );
      L.push(`  ${cats}`);
      for (const e of s.errors) L.push(`  ✗ ${e}`);
      for (const f of s.citations.failed.slice(0, 3)) L.push(`  ✗ 引文找不到（${f.reason}）：「${f.quote.slice(0, 60)}」`);
    });
    L.push(`同題 ${r.baseline.length} 次：${r.consistent ? "答案一致" : `出現 ${r.distinct} 種不同答案`}`);
    L.push("");
  }
  return L.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
