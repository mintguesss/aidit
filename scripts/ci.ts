import { execSync } from "node:child_process";
import { checkBoundaries, scanSecrets, GUARDED } from "./lib/checks";

/**
 * CI 檢查（docs/BACKEND.md §10）。
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

/**
 * CI 一律離線跑，不讀 .env、不連任何外部服務。
 *
 * CI 是回歸閘門：第 3 項「正確率不得下降、錯答須為 0」只有在每一次都跑同一套
 * 確定性替身時才是機械保證。GitHub Actions 上沒有 .env，本來就是離線的；
 * 但本機（尤其是接了自架模型的家用主機）若讀進 .env，評測那一步就會去呼叫模型 ——
 * 本機 CI 與遠端 CI 測的不再是同一件事，而且結果會隨模型的不確定性浮動。
 *
 * 這裡明確清空，而不是只是不載入 .env：開發者 shell 裡可能本來就設了這些變數。
 * 子程序的 .env 載入器以「已存在的環境變數優先」，設成空字串就不會被 .env 蓋回去。
 *
 * 要拿真實模型比較評測數據，直接跑 `npm run eval`，它仍會讀 .env。
 */
const OFFLINE: Record<string, string> = {
  ANTHROPIC_API_KEY: "",
  AIDIT_LLM_PROVIDER: "",
  AIDIT_LLM_MODEL: "",
  AIDIT_LLM_BASE_URL: "",
  AIDIT_LLM_API_KEY: "",
  AIDIT_LLM_REASONING_EFFORT: "",
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
};

function sh(cmd: string): void {
  execSync(cmd, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, ...OFFLINE },
  });
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
