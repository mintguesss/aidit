/**
 * 刪除全部學生試用的原始紀錄（同意書承諾決賽結束後刪除）。先匯出 CSV 並做好去識別統計再跑。
 *
 *   npm run trial:purge -- --yes
 */
// 必須排在其他 import 之前：下面的模組在載入時就會讀 process.env
import "@/lib/util/env";
import { listSessions, purgeAllTrials } from "@/lib/trial/store";

async function main() {
  const rows = await listSessions();
  console.log(`目前有 ${rows.length} 位受試者的紀錄。`);
  if (!process.argv.includes("--yes")) {
    console.log("沒有刪除任何資料。確定要刪除請加 --yes。");
    return;
  }
  console.log(`已刪除 ${await purgeAllTrials()} 個檔案。`);
}

main().catch((e) => {
  console.error(`刪除失敗：${String(e)}`);
  process.exit(1);
});
