import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * CI 檢查的共用實作（docs/BACKEND.md §10）。
 * 同時被 scripts/ci.ts 與 tests/boundaries.test.ts 使用，
 * 避免 CI 與測試各自維護一份規則而漸漸走鐘。
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** 這三個模組是確定性運算的保證，任何情況下都不得呼叫 LLM */
export const GUARDED = [
  "src/lib/audit/engine.ts",
  "src/lib/audit/assign.ts",
  "src/lib/solver/schedule.ts",
  "src/lib/solver/slots.ts",
  "src/lib/verify/citation.ts",
];

/** 被視為 LLM client 的模組與套件 */
const LLM_MARKERS = [
  "@anthropic-ai/sdk",
  "@/lib/llm/client",
  "lib/llm/client",
  "openai",
  "@google/generative-ai",
];

export type Violation = { file: string; via: string[]; marker: string };

/**
 * 由受保護模組出發做遞移相依分析。
 * 只檢查直接 import 是不夠的 —— 多一層轉呼叫就繞過去了。
 */
export function checkBoundaries(): Violation[] {
  const violations: Violation[] = [];
  for (const entry of GUARDED) {
    const start = join(ROOT, entry);
    if (!existsSync(start)) {
      violations.push({ file: entry, via: [], marker: "受保護模組不存在，請更新 GUARDED 清單" });
      continue;
    }
    const seen = new Set<string>();
    const stack: { file: string; path: string[] }[] = [{ file: start, path: [entry] }];
    while (stack.length > 0) {
      const { file, path } = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);

      const src = readFileSync(file, "utf8");
      for (const spec of importsOf(src)) {
        const marker = LLM_MARKERS.find((m) => spec === m || spec.startsWith(`${m}/`));
        if (marker) {
          violations.push({ file: entry, via: path, marker: spec });
          continue;
        }
        const next = resolveImport(spec, file);
        if (next) stack.push({ file: next, path: [...path, rel(next)] });
      }
    }
  }
  return violations;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const DYNAMIC_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(src: string): string[] {
  const out: string[] = [];
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1]!);
  }
  return out;
}

function resolveImport(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // 外部套件；不是 LLM marker 就不追

  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function rel(p: string): string {
  return relative(ROOT, p).replace(/\\/g, "/");
}

// ---------------------------------------------------------------- 金鑰掃描

export type SecretHit = { file: string; line: number; rule: string; sample: string };

const SECRET_RULES: { rule: string; re: RegExp }[] = [
  { rule: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { rule: "OpenAI API key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { rule: "Supabase service role key", re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./ },
  { rule: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "私鑰檔頭", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  // 真實學號：連續 7–12 位數字。合成資料一律使用 S-XXXX 代號或帶遮蔽點的字串
  { rule: "疑似真實學號", re: /(?<![\d.\-_v])\d{7,12}(?![\d.\-_])/ },
];

/** 允許出現數字序列的情境（版本號、時間戳記、雜湊測試值等） */
const SECRET_ALLOW = [
  /\d{4}-\d{2}-\d{2}/, // 日期
  /\b\d{4}-[12]\b/, // 學期代號
  /thread\/\d+/, // 合成討論串網址
];

export function scanSecrets(): SecretHit[] {
  const hits: SecretHit[] = [];
  const targets = [
    ...walk(SRC),
    ...walk(join(ROOT, "scripts")),
    ...walk(join(ROOT, "tests")),
    ...["package.json", "next.config.ts", "tailwind.config.ts", ".env.example"]
      .map((f) => join(ROOT, f))
      .filter(existsSync),
  ];

  for (const file of targets) {
    if (!/\.(ts|tsx|json|md|txt|css)$/.test(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // 去識別機制本身的測試必須帶假學號；以 pii-fixture 註解明確標示後才允許，
      // 標示可寫在同一行或前一行（比照 eslint-disable-next-line 的慣例）
      if (line.includes("pii-fixture") || (lines[i - 1]?.includes("pii-fixture") ?? false)) return;
      if (SECRET_ALLOW.some((a) => a.test(line))) return;
      for (const r of SECRET_RULES) {
        const m = r.re.exec(line);
        if (m) hits.push({ file: rel(file), line: i + 1, rule: r.rule, sample: m[0].slice(0, 12) });
      }
    });
  }
  return hits;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
