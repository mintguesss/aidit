// 必須排在其他 import 之前：下面的模組在載入時就會讀 process.env
import "@/lib/util/env";
import { readFileSync, existsSync } from "node:fs";
import { normalizeOffering, type RawOffering } from "@/lib/offerings";
import { publishOfferings, listPublishedTerms } from "@/lib/offerings/published";
import { supabaseConfigured } from "@/lib/store/supabase";

/**
 * 把一學期的開課資料上傳到資料庫（supabase/migrations/0004_offerings.sql），整學期取代。
 *
 *   npx tsx scripts/push-offerings.ts src/lib/offerings/data/fju-115-1.json "輔大學生資訊平台課程查詢"
 *   npx tsx scripts/push-offerings.ts --list
 *
 * 新學期的流程：fju-sis-fetch.py 抓 → fju-sis-offerings.py 轉 → 這支上傳。網站十分鐘內載入，
 * 不用 commit、不用重新部署。轉出來的 JSON 不一定要進 repo（repo 版本只是 CI 與離線的基準）。
 *
 * 上傳前先檢查：整份是同一所學校、同一學期；每一班時段都解析得了（解析不了的照樣上傳，
 * 但列出來 —— 那幾班不參與衝堂判定）。
 */
async function main() {
  if (!supabaseConfigured()) {
    console.error("沒有設定 Supabase（.env 的 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY）。");
    process.exit(1);
  }
  if (process.argv[2] === "--list") {
    for (const t of await listPublishedTerms()) console.log(`${t.school} ${t.year}-${t.term}：${t.count} 班`);
    return;
  }

  const [path, source] = process.argv.slice(2);
  if (!path || !existsSync(path) || !source) {
    console.error('用法：npx tsx scripts/push-offerings.ts <開課資料 JSON> "<來源說明>"　或　--list');
    process.exit(2);
  }

  const rows = JSON.parse(readFileSync(path, "utf8")) as RawOffering[];
  if (rows.length === 0) {
    console.error("檔案裡沒有任何一班。學校還沒公布的學期不要上傳空的 —— 會蓋掉 repo 裡的版本。");
    process.exit(1);
  }
  const keys = new Set(rows.map((r) => `${r.school ?? "demo"}:${r.year}-${r.term}`));
  if (keys.size !== 1) {
    console.error(`一個檔案只能是同一所學校的同一學期，這份有：${[...keys].join("、")}`);
    process.exit(1);
  }
  const first = rows[0]!;
  if (first.term === "summer") {
    console.error("暑修還不支援上傳。");
    process.exit(1);
  }

  const unknown = rows.map(normalizeOffering).filter((o) => o.slotsUnknown);
  if (unknown.length > 0) {
    console.warn(`時段解析不了 ${unknown.length} 班（照樣上傳，不參與衝堂判定）：` +
      unknown.slice(0, 5).map((o) => `${o.name} ${o.rawSlotText}`).join("、"));
  }

  const fetchedAt = rows.reduce((latest, r) => (r.fetchedAt > latest ? r.fetchedAt : latest), first.fetchedAt);
  await publishOfferings({
    school: first.school ?? "demo",
    year: first.year,
    term: first.term,
    rows,
    source,
    fetchedAt,
  });
  console.log(`已上傳 ${first.school} ${first.year}-${first.term}：${rows.length} 班（抓取時間 ${fetchedAt}）。`);
}

main().catch((e) => {
  console.error(`上傳失敗：${String(e)}`);
  process.exit(1);
});
