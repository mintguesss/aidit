// 必須排在其他 import 之前：下面的模組在載入時就會讀 process.env
import "@/lib/util/env";
import { draftStore } from "@/lib/review/drafts";
import { supabaseConfigured } from "@/lib/store/supabase";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { z } from "zod/v4";
import { structured, LlmBudget, llmAvailable } from "@/lib/llm/client";
import { normalize, fuzzyBestMatch } from "@/lib/util/text";
import { contentHash } from "@/lib/util/identity";

/**
 * 規則包抽取（docs/BACKEND.md §2）。
 *
 * 離線批次，不是執行期解析。輸出是**草稿**（provenance=draft），
 * 必須經過自動驗證與人工校對頁確認後才會被 loader 接受。
 *
 * 流程：
 *   課程規劃表 PDF
 *     ↓ scripts/pdf-to-segments.py（pdfplumber，保留頁碼與版面）
 *   分段文字 JSON
 *     ↓ 本腳本：LLM 結構化抽取，每個欄位都必須帶 citation.quote
 *   RulePack 草稿 + 語料檔
 *     ↓ scripts/validate-rulepack.ts
 *     ↓ /review 人工校對頁
 *   鎖定版本 + content hash
 *
 * 用法：
 *   npm run rulepack:extract -- --segments .data/segments/plan-im-111.json \
 *     --id im-112 --dept IM --year 112 --college MGT
 */

const zExtracted = z.object({
  minCredits: z.number().int().positive(),
  minCreditsQuote: z.string().min(4),
  minCreditsPage: z.number().int().positive(),
  categories: z
    .array(
      z.object({
        name: z.string().min(1),
        shortName: z.string().min(1).max(6),
        credits: z.number().int().nonnegative(),
        /** courseList / selectType / deptElective / anyPassed */
        matchType: z.enum(["courseList", "selectType", "deptElective", "anyPassed"]),
        /** matchType=courseList 時的課號清單 */
        codes: z.array(z.string()),
        /** matchType=selectType 時的選別 */
        selectType: z.enum(["required", "elective", "general"]).nullable(),
        locator: z.string().min(1),
        /** 逐字取自原文，不得改寫 */
        quote: z.string().min(4),
        page: z.number().int().positive(),
      }),
    )
    .min(1),
  /** 規則有洞的地方：允許某種採計但未列明範圍 */
  ambiguities: z.array(
    z.object({
      categoryName: z.string().min(1),
      description: z.string().min(1),
      locator: z.string().min(1),
      quote: z.string().min(4),
      page: z.number().int().positive(),
    }),
  ),
  graduationChecks: z.array(
    z.object({
      name: z.string().min(1),
      /** 規劃表是否僅記載「各系自訂」之類未定內容 */
      deptDefined: z.boolean(),
      locator: z.string().min(1),
      quote: z.string().min(4),
      page: z.number().int().positive(),
    }),
  ),
});

const SYSTEM = [
  "你是課程規劃表的結構化抽取元件。",
  "任務：從提供的原文中抽出畢業學分結構，並為每一個欄位附上逐字引用。",
  "規則：",
  "1. quote 必須逐字取自原文，不得改寫、不得補字、不得合併不相鄰的句子。",
  "2. 找不到明確依據的欄位，寧可不輸出，也不要推測。",
  "3. 附註中出現「得經認定後採計」「由各系自訂」「另行公告」這類未列明範圍的敘述時，",
  "   必須記入 ambiguities —— 那是規則的洞，不是可以自行補齊的細節。",
  "4. 課號格式為兩碼英文字母加四碼數字。",
].join("\n");

type Segments = {
  docId: string;
  title: string;
  source?: string;
  pages: { page: number; text: string; tables?: string[][][] }[];
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["segments", "id", "dept", "year", "college"] as const;
  const missing = required.filter((k) => !args[k]);
  if (missing.length > 0) {
    console.error(`缺少參數：${missing.map((m) => `--${m}`).join(" ")}`);
    console.error(
      "用法：npm run rulepack:extract -- --segments <segments.json> --id im-112 --dept IM --year 112 --college MGT [--program day]",
    );
    process.exit(2);
  }

  if (!llmAvailable()) {
    console.error(
      "未設定 ANTHROPIC_API_KEY。規則抽取是離線批次作業，必須使用真實模型 ——\n" +
        "離線替身只適用於執行期的規則解消與意圖解析，不得用來生成規則包。",
    );
    process.exit(1);
  }

  const segments = JSON.parse(readFileSync(args.segments!, "utf8")) as Segments;
  const fullText = segments.pages.map((p) => `【第 ${p.page} 頁】\n${p.text}`).join("\n\n");

  // 抽取用的預算與執行期分開：這是離線作業，不受「每次審查 3 次」的限制
  const budget = new LlmBudget(8);
  const res = await structured(
    {
      system: SYSTEM,
      user: [`文件標題：${segments.title}`, "原文：", fullText].join("\n"),
      schema: zExtracted,
      effort: "high",
      offline: () => {
        throw new Error("規則抽取不提供離線替身");
      },
    },
    budget,
  );

  const draft = toDraft(res.data, segments, args);
  const verified = verifyQuotes(res.data, fullText);

  const outDir = join(process.cwd(), ".data", "drafts");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${args.id}.json`);
  writeFileSync(outPath, JSON.stringify(draft, null, 2), "utf8");

  // 語料檔同步落地：沒有語料，citation.verify 就沒有比對對象
  const corpusPath = join(process.cwd(), "src", "lib", "rules", "corpus", `${segments.docId}.txt`);
  if (!existsSync(dirname(corpusPath))) mkdirSync(dirname(corpusPath), { recursive: true });
  writeFileSync(corpusPath, fullText, "utf8");

  console.log(`草稿已寫入　${outPath}`);
  console.log(`語料已寫入　${corpusPath}`);

  // 設定了 Supabase 就一併上傳。抽取需要金鑰、跑在本機，校對卻是線上作業 ——
  // 少了這一步，線上的校對頁永遠是空的。
  if (supabaseConfigured()) {
    try {
      await draftStore().save(args.id!, {
        draft: draft as Record<string, unknown>,
        corpus: new Map([[segments.docId, fullText]]),
      });
      console.log(`草稿已上傳　rulepack_drafts/${args.id}（校對頁可直接開啟）`);
    } catch (e) {
      // 上傳失敗不該讓整支腳本白跑，本機檔案已經寫好了
      console.warn(`草稿上傳失敗（本機檔案仍在）：${String(e)}`);
    }
  }
  console.log(`LLM 用量　　${budget.usage.calls} 次呼叫、US$${budget.usage.costUsd.toFixed(6)}`);
  console.log("");
  console.log("引用回查結果：");
  for (const v of verified) {
    console.log(`  ${v.ok ? "✓" : "✗"} ${v.where}　${v.ok ? v.method : `最佳相似度 ${(v.ratio * 100).toFixed(1)}%`}`);
  }
  const failed = verified.filter((v) => !v.ok);
  console.log("");
  console.log(
    failed.length === 0
      ? "所有引用皆可回查原文。接著執行 `npm run rulepack:validate`，再到 /review 進行人工校對。"
      : `有 ${failed.length} 條引用無法回查原文，請先修正抽取結果再進人工校對。`,
  );
  if (failed.length > 0) process.exit(1);
}

function toDraft(
  d: z.infer<typeof zExtracted>,
  segments: Segments,
  args: Record<string, string | undefined>,
): Record<string, unknown> {
  const docId = segments.docId;
  const cite = (locator: string, quote: string) => ({ docId, locator, quote });

  const categories = d.categories.map((c, i) => ({
    id: slug(c.name, i),
    name: c.name,
    shortName: c.shortName,
    credits: c.credits,
    order: i + 1,
    match:
      c.matchType === "courseList"
        ? { type: "courseList", codes: c.codes }
        : c.matchType === "selectType"
          ? { type: "selectType", value: c.selectType ?? "general" }
          : c.matchType === "deptElective"
            ? { type: "deptElective", dept: args.dept }
            : { type: "anyPassed" },
    subRules: [],
    ambiguities: d.ambiguities
      .filter((a) => a.categoryName === c.name)
      .map((a, j) => ({
        id: `${slug(c.name, i)}-amb-${j + 1}`,
        description: a.description,
        // trigger 無法從原文自動判定，一律留空給人工校對填寫
        trigger: { type: "courseFromOtherCollege" },
        affects: "thisCategory",
        citation: cite(a.locator, a.quote),
        contact: "（待人工校對填寫）",
        searchedSources: ["（待人工校對填寫）"],
      })),
    citation: cite(c.locator, c.quote),
  }));

  return {
    id: args.id,
    dept: args.dept,
    admissionYear: Number(args.year),
    program: args.program ?? "day",
    version: args.version ?? "0.1",
    approvedAt: new Date().toISOString().slice(0, 10),
    provenance: "draft",
    approvedBy: null,
    minCredits: d.minCredits,
    college: args.college,
    documents: [
      {
        id: docId,
        title: segments.title,
        corpusFile: `${docId}.txt`,
      },
    ],
    categories,
    overflowPolicy: {},
    graduationChecks: d.graduationChecks.map((g, i) => ({
      id: slug(g.name, i),
      name: g.name,
      rule: g.deptDefined ? "deptDefined" : "evidence",
      contact: "（待人工校對填寫）",
      searchedSources: [],
      citation: cite(g.locator, g.quote),
    })),
    termLimits: { maxCredits: 25, minCredits: 9 },
    _draft: {
      extractedAt: new Date().toISOString(),
      sourceFile: segments.source ?? null,
      contentHash: contentHash(d),
      todo: [
        "填寫每個 ambiguity 的 trigger 類型與建議洽詢單位",
        "填寫 overflowPolicy（哪些類別的超修計入總學分）",
        "確認 subRules（如通識領域分布）",
        "確認 termLimits 是否與學則一致",
      ],
    },
  };
}

type QuoteCheck = { where: string; ok: boolean; method: string; ratio: number };

function verifyQuotes(d: z.infer<typeof zExtracted>, fullText: string): QuoteCheck[] {
  const body = normalize(fullText);
  const check = (where: string, quote: string): QuoteCheck => {
    const q = normalize(quote);
    if (body.includes(q)) return { where, ok: true, method: "exact", ratio: 1 };
    const best = fuzzyBestMatch(q, body);
    return { where, ok: best.ratio >= 0.9, method: "fuzzy", ratio: best.ratio };
  };

  return [
    check("minCredits", d.minCreditsQuote),
    ...d.categories.map((c) => check(`類別「${c.name}」`, c.quote)),
    ...d.ambiguities.map((a) => check(`ambiguity「${a.description.slice(0, 12)}…」`, a.quote)),
    ...d.graduationChecks.map((g) => check(`畢業條件「${g.name}」`, g.quote)),
  ];
}

function slug(name: string, i: number): string {
  const map: Record<string, string> = {
    校訂共同必修: "common-required",
    通識: "general",
    通識涵養課程: "general",
    院基礎必修: "college-core",
    系專業必修: "major-required",
    系專業選修: "major-elective",
    自由選修: "free-elective",
  };
  return map[name] ?? `category-${i + 1}`;
}

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1]?.startsWith("--") ? "true" : argv[++i];
  }
  return out;
}

void main();
