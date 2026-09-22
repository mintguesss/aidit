import { execSync } from "node:child_process";
import { checkBoundaries, scanSecrets, GUARDED } from "./lib/checks";

/**
 * CI 檢查（BACKEND.md §10）。
 *
 * 第 4 條（模組邊界）是整個專案最重要的一條，因為它用機械方式保證了
 * 「算數的那層沒有模型」這個技術主張。答詢時可以直接把這支腳本調出來給評審看。
 */

type Check = { id: string; name: string; run: () => void };

const CHECKS: Check[] = [
  {
    id: "1",
    name: "不變式與 golden set 回歸（vitest）",
    run: () => sh("npx vitest run --reporter=dot"),
  },
  {
    id: "2",
    name: "型別檢查",
    run: () => sh("npx tsc --noEmit"),
  },
  {
    id: "3",
    name: "評測回歸：正確率不得下降、錯答須為 0",
    run: () => sh("npx tsx src/eval/run.ts"),
  },
  {
    id: "4",
    name: `模組邊界：${GUARDED.join("、")} 及其相依模組不得 import LLM client`,
    run: () => {
      const v = checkBoundaries();
      if (v.length > 0) {
        throw new Error(
          v.map((x) => `  ${x.file} 經 ${x.via.join(" → ")} 引入了 ${x.marker}`).join("\n"),
        );
      }
    },
  },
  {
    id: "5",
    name: "注入測試語料：攔截率與誤攔率不得下降",
    run: () => sh("npx tsx src/eval/injection/run.ts"),
  },
  {
    id: "6",
    name: "原始碼與設定檔不得含金鑰或真實學號",
    run: () => {
      const hits = scanSecrets();
      if (hits.length > 0) {
        throw new Error(
          hits.map((h) => `  ${h.file}:${h.line} ${h.rule}（${h.sample}…）`).join("\n"),
        );
      }
    },
  },
  {
    id: "7",
    name: "規則包 schema 與自動驗證",
    run: () => sh("npx tsx scripts/validate-rulepack.ts"),
  },
];

function sh(cmd: string): void {
  execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

function main() {
  const failures: { check: Check; error: string }[] = [];
  for (const c of CHECKS) {
    process.stdout.write(`[${c.id}] ${c.name} … `);
    try {
      c.run();
      console.log("通過");
    } catch (err) {
      console.log("失敗");
      const e = err as { message?: string; stdout?: string; stderr?: string };
      failures.push({
        check: c,
        error: [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim(),
      });
    }
  }

  console.log("");
  if (failures.length === 0) {
    console.log(`全部 ${CHECKS.length} 項 CI 檢查通過。`);
    return;
  }
  console.error(`${failures.length} 項 CI 檢查失敗：`);
  for (const f of failures) {
    console.error(`\n── [${f.check.id}] ${f.check.name} ──`);
    console.error(f.error);
  }
  process.exit(1);
}

main();
