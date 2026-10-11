// 順序有意義：guard 要在任何讀環境變數的模組之前
import { LIVE } from "../baseline-c/guard";
import "@/lib/util/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { LlmBudget, MODEL_LABEL } from "@/lib/llm/client";
import { runAudit } from "@/lib/agent/runner";
import { preloadPublishedRules, resolveRulePack } from "@/lib/rules/loader";
import { preloadOfferings } from "@/lib/offerings/published";
import { fixture } from "@/lib/providers/fixtures";
import { constraintSetFrom, preferencesOf } from "@/lib/chat/apply";
import { planTurn, type TurnContext } from "@/lib/chat/route";
import type { ChatMessage } from "@/lib/chat/types";
import { UNDERSTANDING_CASES, type UnderstandingCase } from "./cases";

/**
 * 對話理解跑分。
 *
 *   npm run eval:understanding              只有規則（離線，不花錢）
 *   npm run eval:understanding -- --live    接 .env 設定的模型（會花錢，40 題約 US$0.03）
 *   --only ai-days-early                    只跑一題
 *
 * 報告寫到 .data/understanding-report.txt。
 */

const FX = "fju-im-111-year2";
const NL = String.fromCharCode(10);
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

type Result = { detail?: string; refused?: string[]; c: UnderstandingCase; ok: boolean; why: string[]; labels: string[]; kind: string; headline: string; ms: number; cost: number };

async function main() {
  await Promise.all([preloadPublishedRules(), preloadOfferings()]);
  const run = await runAudit({ providerKind: "mock", fixture: FX, currentTerm: "112-2" });
  if (!run.ok) throw new Error(`審查失敗：${run.error.reason}`);
  const record = fixture(FX).record;
  const pack = resolveRulePack(record.student);
  if (!pack.ok) throw new Error(pack.detail);
  const original = constraintSetFrom(preferencesOf(record.preferences));

  const results: Result[] = [];
  for (const c of UNDERSTANDING_CASES.filter((x) => !ONLY || x.id === ONLY)) {
    let ctx: TurnContext = { audit: run.audit, record, pack: pack.pack, constraints: original, originalConstraints: original, currentPlan: run.state.plans[0] };
    const history: ChatMessage[] = [];
    let last: Awaited<ReturnType<typeof planTurn>> | undefined;
    let ms = 0;
    let cost = 0;
    for (const said of [...(c.before ?? []), c.said]) {
      history.push({ role: "user", content: said });
      const budget = new LlmBudget(2);
      const t0 = Date.now();
      last = await planTurn([...history], ctx, budget);
      ms = Date.now() - t0;
      cost += budget.usage.costUsd;
      history.push({ role: "assistant", content: last.reply.headline, meta: { kind: last.reply.kind, clarifying: last.clarifying } });
      if (last.plan) {
        const shown = last.plan.solve.ok ? last.plan.solve.plans[0] : undefined;
        ctx = {
          ...ctx,
          constraints: last.plan.constraintSet,
          shownCodes: shown?.courses.map((x) => x.code),
          shownSlots: shown ? Object.fromEntries(shown.courses.map((x) => [x.code, x.slotText])) : undefined,
        };
      }
    }
    const labels = last?.plan?.constraints ?? [];
    const hay = labels.map((l) => l.toLowerCase());
    const why: string[] = [];
    for (const h of c.has ?? []) if (!hay.some((l) => l.includes(h.toLowerCase()))) why.push(`缺「${h}」`);
    for (const h of c.lacks ?? []) if (hay.some((l) => l.includes(h.toLowerCase()))) why.push(`不該有「${h}」`);
    if (c.kind && last?.reply.kind !== c.kind) why.push(`回覆類型 ${last?.reply.kind}，應為 ${c.kind}`);
    results.push({ detail: last?.reply.detail, refused: last?.plan?.refusedParams, c, ok: why.length === 0, why, labels, kind: last?.reply.kind ?? "", headline: last?.reply.headline ?? "", ms, cost });
    process.stdout.write(why.length === 0 ? "." : "x");
  }

  const pass = results.filter((r) => r.ok).length;
  const old = results.filter((r) => !r.c.newFeature);
  const L = [
    `# 對話理解跑分（${new Date().toISOString().slice(0, 10)}）`,
    `模式：${LIVE ? `模型 ${MODEL_LABEL}` : "只有規則（離線）"}`,
    `全部 ${pass}/${results.length}；不含新功能題 ${old.filter((r) => r.ok).length}/${old.length}`,
    `平均延遲 ${(results.reduce((a, r) => a + r.ms, 0) / Math.max(1, results.length) / 1000).toFixed(1)} 秒；成本 US$${results.reduce((a, r) => a + r.cost, 0).toFixed(4)}`,
    "",
    ...results
      .filter((r) => !r.ok)
      .map((r) =>
        [
          `✗ ${r.c.id}${r.c.newFeature ? "（新功能）" : ""}「${r.c.said}」`,
          `   ${r.why.join("；")}`,
          `   回覆：[${r.kind}] ${r.headline}${r.detail ? `｜${r.detail.split(NL).join(" ／ ")}` : ""}`,
          `   條件：${r.labels.join("・")}`,
          ...(r.refused?.length ? [`   擋下：${r.refused.join("、")}`] : []),
        ].join(NL),
      ),
  ];
  mkdirSync(".data", { recursive: true });
  writeFileSync(`.data/understanding-report${LIVE ? "-live" : ""}.txt`, L.join("\n"));
  console.log("\n" + L.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
