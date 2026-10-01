// 必須排在其他 import 之前：下面的模組在載入時就會讀 process.env
import "@/lib/util/env";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { draftStore } from "@/lib/review/drafts";

/**
 * 把本機的規則包草稿（連同它宣告的原文語料）存進草稿儲存層，讓校對頁看得到。
 *
 *   npx tsx scripts/push-draft.ts .data/drafts/fju-im-111.json
 *
 * scripts/extract-rulepack.ts 抽取完會自己上傳；這支是給「已經在本機的草稿」用的 ——
 * 手動抽取的、或人工改過再重傳的。上傳前先跑 validate-rulepack，不通過的草稿
 * 不該進人工校對（docs/BACKEND.md §2）。
 *
 * 設定了 Supabase 就存資料庫（需要 migration 0003 的 rulepack_drafts），否則存 .data/drafts/。
 */
async function main() {
  const path = process.argv[2];
  if (!path || !existsSync(path)) {
    console.error("用法：npx tsx scripts/push-draft.ts <草稿 JSON 路徑>");
    process.exit(2);
  }

  const draft = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const packId = String(draft.id ?? "");
  if (!packId) {
    console.error("草稿沒有 id。");
    process.exit(1);
  }

  // 語料跟草稿一起存：分開的話會出現「草稿在、語料不在」的半套狀態
  const corpus = new Map<string, string>();
  const docs = (draft.documents as { id: string; corpusFile?: string }[] | undefined) ?? [];
  for (const d of docs) {
    if (!d.corpusFile) continue;
    const p = join(process.cwd(), "src", "lib", "rules", "corpus", d.corpusFile);
    if (!existsSync(p)) {
      console.error(`找不到語料檔 ${p}。沒有語料，校對頁的引用就無法回查原文。`);
      process.exit(1);
    }
    corpus.set(d.id, readFileSync(p, "utf8"));
  }

  const store = draftStore();
  await store.save(packId, { draft, corpus });
  console.log(`草稿 ${packId} 已存入 ${store.kind === "supabase" ? "Supabase（rulepack_drafts）" : ".data/drafts/"}，` +
    `含 ${corpus.size} 份語料。校對頁：/review/${packId}`);
}

main().catch((e) => {
  console.error(`上傳失敗：${String(e)}`);
  process.exit(1);
});
