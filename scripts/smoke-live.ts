/**
 * 部署後與上場前的實測：對話真的有用到模型嗎？
 *
 *   npm run smoke                       # 預設測正式站
 *   npm run smoke -- --base http://localhost:3000
 *   npm run smoke -- --export <資料夾>   # 順便把各輪 trace 存成 JSON
 *
 * 模型失敗時對話會退回規則，頁面完全正常，/api/health 也看不出來。這支送幾句真的話，
 * 檢查模型呼叫次數與回答意圖；任何一句沒通過就以非零結束。整輪約 US$0.002。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argValue = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const base = (argValue("--base") ?? "https://aidit-weld.vercel.app").replace(/\/$/, "");
const exportDir = argValue("--export");

type Probe = { scope: "ask" | "plan"; said: string; expectIntent?: string };

/** 第一句問本人進度、第二句是只有模型聽得懂的口語（只靠規則會答不出來） */
const PROBES: Probe[] = [
  { scope: "ask", said: "我還差幾學分才能畢業？", expectIntent: "personal-audit" },
  { scope: "plan", said: "課可以排緊一點嗎" },
  { scope: "ask", said: "人生哲學是哪個老師開的", expectIntent: "course-info" },
];

async function main() {
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  console.log(`${base}　資料庫 ${health.store?.kind}／${health.store?.ok ? "通" : "不通"}　模型 ${health.llm?.model}`);

  let failed = 0;
  for (const p of PROBES) {
    const started = Date.now();
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: p.said }], scope: p.scope }),
    });
    const body = await res.json();
    const problems = [
      res.ok ? "" : `HTTP ${res.status}`,
      body.tools?.includes("rule.degraded") ? "模型失敗，退回規則" : "",
      body.llm?.calls > 0 ? "" : "沒有呼叫模型",
      p.expectIntent && body.intent !== p.expectIntent ? `意圖是 ${body.intent}，應為 ${p.expectIntent}` : "",
      body.intent === "out-of-scope" ? "回覆超出範圍" : "",
    ].filter(Boolean);
    if (problems.length) failed += 1;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${problems.length ? "✗" : "✓"} ${p.said}　${secs} 秒　模型 ${body.llm?.calls ?? "?"} 次　trace ${body.traceId ?? "無"}`);
    if (problems.length) console.log(`    ${problems.join("；")}`);

    if (exportDir && body.traceId) {
      mkdirSync(exportDir, { recursive: true });
      const trace = await fetch(`${base}/api/trace/${body.traceId}`).then((r) => r.text());
      writeFileSync(join(exportDir, `${body.traceId}.json`), trace);
    }
  }

  if (failed) {
    console.error(`\n${failed}／${PROBES.length} 句沒通過。先查模型額度與部署的 ANTHROPIC_API_KEY，錯誤原因在部署紀錄（搜尋 [chat]）。`);
    process.exit(1);
  }
  console.log(`\n全部通過（${PROBES.length} 句）。`);
}

main().catch((e) => {
  console.error(`實測失敗：${String(e)}`);
  process.exit(1);
});
