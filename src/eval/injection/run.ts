// 必須排在其他 import 之前：下面的模組在載入時就會讀 process.env
import "@/lib/util/env";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scanText, wrapExternal } from "@/lib/safety/scan";
import { INJECTION_CORPUS } from "./corpus";

/**
 * 注入測試執行器（SPEC.md §10）。
 *
 * 同時量測攔截率與誤攔率。只報攔截率是沒有意義的 ——
 * 把所有外部內容都丟掉也能得到 100% 攔截率。
 */

type Row = {
  id: string;
  label: "malicious" | "benign";
  technique: string;
  blocked: boolean;
  patterns: string;
  correct: boolean;
};

function main() {
  const rows: Row[] = INJECTION_CORPUS.map((s) => {
    const r = scanText(s.text, s.sourceUrl);
    const blocked = !r.safe;
    return {
      id: s.id,
      label: s.label,
      technique: s.technique,
      blocked,
      patterns: r.blocked[0]?.patternMatched ?? "—",
      correct: s.label === "malicious" ? blocked : !blocked,
    };
  });

  const mal = rows.filter((r) => r.label === "malicious");
  const ben = rows.filter((r) => r.label === "benign");
  const caught = mal.filter((r) => r.blocked).length;
  const falsePositives = ben.filter((r) => r.blocked).length;

  const lines: string[] = [];
  lines.push("Aidit 提示注入測試報告");
  lines.push(`產生時間　${new Date().toISOString()}`);
  lines.push("");
  lines.push("── 指標 ──────────────────────────────────────");
  lines.push(`惡意樣本　${mal.length} 則，攔截 ${caught} 則　攔截率 ${((caught / mal.length) * 100).toFixed(1)}%`);
  lines.push(`正常樣本　${ben.length} 則，誤攔 ${falsePositives} 則　誤攔率 ${((falsePositives / ben.length) * 100).toFixed(1)}%`);
  lines.push("");
  lines.push("── 逐則結果 ──────────────────────────────────");
  for (const r of rows) {
    lines.push(
      `${r.correct ? "✓" : "✗"} [${r.id}] ${r.label === "malicious" ? "惡意" : "正常"}　${r.technique}` +
        `　→ ${r.blocked ? `攔截（${r.patterns}）` : "放行"}`,
    );
  }
  lines.push("");
  lines.push("── 縱深防禦 ──────────────────────────────────");
  lines.push("樣式比對只是第一層。即使某一則漏過 safety.scan，它仍受下列限制：");
  lines.push("  1. 外部內容一律包在 <external_content> 資料區塊內，永不進入指令通道");
  lines.push("  2. credit.audit / schedule.solve / citation.verify 完全不接觸外部內容，且不得 import LLM client（CI 檢查）");
  lines.push("  3. 系統架構上沒有寫入校務系統的 endpoint，「幫我加選」在物理上做不到");
  lines.push("");
  lines.push("── 資料區塊包裝範例 ──────────────────────────");
  lines.push(wrapExternal(INJECTION_CORPUS[0]!.text, INJECTION_CORPUS[0]!.sourceUrl, INJECTION_CORPUS[0]!.postedAt));

  const out = lines.join("\n");
  console.log(out);

  const dir = join(process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "injection-report.txt"), out, "utf8");

  const failed = rows.filter((r) => !r.correct);
  if (failed.length > 0) {
    console.error(`\n注入測試失敗：${failed.length} 則判斷錯誤（${failed.map((f) => f.id).join("、")}）。`);
    process.exit(1);
  }
}

main();
