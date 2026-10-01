import { readdirSync, readFileSync, existsSync } from "node:fs";
import { describeCourseCodeFormats } from "@/lib/courses/code";
import { join } from "node:path";
import { zRulePack, COURSE_CODE_RE, type RulePack, type RuleCitation } from "@/lib/rules/schema";
import { normalize, fuzzyBestMatch, numeralsOf } from "@/lib/util/text";
import { contentHash } from "@/lib/util/identity";

/**
 * 規則包自動驗證（docs/BACKEND.md §2）。
 *
 * 不通過就不進人工校對頁。抽取時沒留 quote 的欄位，後面就無法驗證，
 * 等同於沒有依據 —— 因此缺 quote 在此直接視為錯誤，而不是警告。
 */

const PACK_DIR = join(process.cwd(), "src", "lib", "rules", "packs");
const CORPUS_DIR = join(process.cwd(), "src", "lib", "rules", "corpus");
const FUZZY_MIN = 0.9;

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
  const err = (message: string) => issues.push({ pack: file, level: "error", message });
  const warn = (message: string) => issues.push({ pack: file, level: "warn", message });

  // 1. 類別學分加總 === minCredits（schema 已檢查，此處保留以便報告可讀）
  const sum = pack.categories.reduce((a, c) => a + c.credits, 0);
  if (sum !== pack.minCredits) err(`類別學分加總 ${sum} ≠ minCredits ${pack.minCredits}`);

  // 2. 課號格式
  for (const cat of pack.categories) {
    if (cat.match.type !== "courseList") continue;
    for (const code of cat.match.codes) {
      if (!COURSE_CODE_RE.test(code)) err(`類別 ${cat.id} 的課號 ${code} 不符合任何已知課號格式（${describeCourseCodeFormats()}）`);
    }
  }

  // 3. 課號不得跨類別重複（同一門必修不能同時列在兩張科目表上）
  const seen = new Map<string, string>();
  for (const cat of pack.categories) {
    if (cat.match.type !== "courseList") continue;
    for (const code of cat.match.codes) {
      const prev = seen.get(code);
      if (prev) err(`課號 ${code} 同時出現在 ${prev} 與 ${cat.id}`);
      seen.set(code, cat.id);
    }
  }

  // 4. 每一條 citation 的 quote 必須能回查原文
  const corpus = new Map<string, string>();
  for (const doc of pack.documents) {
    if (!doc.corpusFile) {
      warn(`文件 ${doc.id} 未提供 corpusFile，其引用無法驗證`);
      continue;
    }
    const p = join(CORPUS_DIR, doc.corpusFile);
    if (!existsSync(p)) {
      err(`文件 ${doc.id} 的語料檔 ${doc.corpusFile} 不存在`);
      continue;
    }
    corpus.set(doc.id, readFileSync(p, "utf8"));
  }

  const check = (c: RuleCitation, where: string) => {
    if (!c.quote) {
      err(`${where} 未留下 quote —— 抽取時沒留 quote 的欄位，後面就無法驗證，等同於沒有依據`);
      return;
    }
    const src = corpus.get(c.docId);
    if (!src) return; // 上面已回報
    const q = normalize(c.quote);
    const body = normalize(src);
    if (body.includes(q)) return;
    const best = fuzzyBestMatch(q, body);
    if (best.ratio >= FUZZY_MIN) {
      // 與 citation.verify 同一條規則：夠像不夠，數字必須完全一樣
      if (numeralsOf(q).join("|") !== numeralsOf(best.window).join("|")) {
        err(
          `${where} 的數字與原文不符（引文 ${numeralsOf(q).join("、") || "無"}；` +
            `原文 ${numeralsOf(best.window).join("、") || "無"}；相似度 ${(best.ratio * 100).toFixed(1)}%）`,
        );
        return;
      }
      warn(`${where} 僅以模糊比對通過（相似度 ${(best.ratio * 100).toFixed(1)}%），建議校對原文`);
      return;
    }
    err(`${where} 的 quote 在原文中查無相符片段（最佳相似度 ${(best.ratio * 100).toFixed(1)}%）`);
  };

  pack.categories.forEach((cat) => {
    check(cat.citation, `類別 ${cat.id}`);
    cat.subRules.forEach((s) => check(s.citation, `類別 ${cat.id} 的 subRule ${s.id}`));
    cat.ambiguities.forEach((a) => check(a.citation, `類別 ${cat.id} 的 ambiguity ${a.id}`));
  });
  pack.graduationChecks.forEach((g) => check(g.citation, `畢業條件 ${g.id}`));
  Object.entries(pack.overflowPolicy).forEach(([k, v]) => check(v.citation, `overflowPolicy ${k}`));
  pack.termLimits.citations.forEach((c, i) => check(c, `修課學分上下限 #${i + 1}`));
  if (pack.minCreditsCitation) check(pack.minCreditsCitation, "畢業最低學分");

  // 5. 鎖版狀態
  if (pack.provenance === "approved" && !pack.approvedBy) {
    err("provenance=approved 但未記錄校對人（approvedBy）");
  }
  if (pack.provenance === "synthetic") {
    warn("本規則包為合成資料，僅供 Demo 與評測，不得用於實際審查");
  }

  return issues;
}

main();
