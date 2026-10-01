// 必須排在其他 import 之前：下面的模組在載入時就會讀 process.env
import "@/lib/util/env";
import { writeFileSync } from "node:fs";
import { draftStore } from "@/lib/review/drafts";

/**
 * 把草稿儲存層裡的最新版草稿拉回本機檔案。
 *
 *   npx tsx scripts/pull-draft.ts fju-im-111 docs/review/fju-im-111.draft.json
 *
 * 校對頁可以直接修改草稿，改完線上那份就比 repo 裡的新。維護者要手動改時，
 * 先用這支拉回最新版、在那份上改，再用 push-draft.ts 上傳 —— 否則會蓋掉校對者的修改
 * （push-draft.ts 會擋）。語料不拉：語料以 repo 的 corpus 目錄為準。
 */
async function main() {
  const [packId, out] = process.argv.slice(2);
  if (!packId || !out) {
    console.error("用法：npx tsx scripts/pull-draft.ts <packId> <輸出的 JSON 路徑>");
    process.exit(2);
  }
  const bundle = await draftStore().load(packId);
  if (!bundle) {
    console.error(`草稿儲存層裡沒有 ${packId}。`);
    process.exit(1);
  }
  writeFileSync(out, JSON.stringify(bundle.draft, null, 2) + "\n", "utf8");
  const edits = (bundle.draft._draft as { edits?: unknown[] } | undefined)?.edits?.length ?? 0;
  console.log(`已寫入 ${out}（版本 ${String(bundle.draft.version)}，校對頁上的修改 ${edits} 筆）。`);
}

main().catch((e) => {
  console.error(`拉取失敗：${String(e)}`);
  process.exit(1);
});
