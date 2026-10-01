import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zRulePack, type RulePack } from "@/lib/rules/schema";
import { validatePack } from "@/lib/rules/validate";
import { contentHash } from "@/lib/util/identity";

/**
 * 規則包自動驗證（docs/BACKEND.md §2）。
 *
 * 不通過就不進人工校對頁。抽取時沒留 quote 的欄位，後面就無法驗證，
 * 等同於沒有依據 —— 因此缺 quote 在此直接視為錯誤，而不是警告。
 */

const PACK_DIR = join(process.cwd(), "src", "lib", "rules", "packs");
const CORPUS_DIR = join(process.cwd(), "src", "lib", "rules", "corpus");

type Issue = { pack: string; level: "error" | "warn"; message: string };

/**
 * 不帶參數：驗證 src/lib/rules/packs/ 底下全部（CI 第 7 項）。
 * 帶檔案路徑：只驗證指定的檔案，用於草稿進人工校對前 ——
 *   npx tsx scripts/validate-rulepack.ts .data/drafts/fju-im-111.json
 */
function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0
    ? args
    : existsSync(PACK_DIR)
      ? readdirSync(PACK_DIR).filter((f) => f.endsWith(".json")).map((f) => join(PACK_DIR, f))
      : [];
  if (files.length === 0) {
    console.error(`${PACK_DIR} 中沒有任何規則包。`);
    process.exit(1);
  }

  const issues: Issue[] = [];
  for (const file of files) {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    const parsed = zRulePack.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        issues.push({ pack: file, level: "error", message: `${i.path.join(".") || "(root)"}：${i.message}` });
      }
      continue;
    }
    issues.push(...validate(file, parsed.data));
    console.log(
      `${file}　provenance=${parsed.data.provenance}　contentHash=${parsed.data.contentHash ?? contentHash(raw)}`,
    );
  }

  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  for (const w of warns) console.warn(`warn  [${w.pack}] ${w.message}`);
  for (const e of errors) console.error(`error [${e.pack}] ${e.message}`);

  if (errors.length > 0) {
    console.error(`\n規則包驗證失敗：${errors.length} 項錯誤。未通過者不得進入人工校對。`);
    process.exit(1);
  }
  console.log(`\n規則包驗證通過（${files.length} 份，警告 ${warns.length} 項）。`);
}

function validate(file: string, pack: RulePack): Issue[] {
  const issues: Issue[] = [];

  // 語料從 repo 的 corpus 目錄讀；缺檔在這裡回報，其餘檢查交給 lib/rules/validate.ts
  const corpus = new Map<string, string>();
  for (const doc of pack.documents) {
    if (!doc.corpusFile) {
      issues.push({ pack: file, level: "warn", message: `文件 ${doc.id} 未提供 corpusFile，其引用無法驗證` });
      continue;
    }
    const p = join(CORPUS_DIR, doc.corpusFile);
    if (!existsSync(p)) {
      issues.push({ pack: file, level: "error", message: `文件 ${doc.id} 的語料檔 ${doc.corpusFile} 不存在` });
      continue;
    }
    corpus.set(doc.id, readFileSync(p, "utf8"));
  }

  return [...issues, ...validatePack(pack, corpus).map((i) => ({ pack: file, ...i }))];
}

main();
