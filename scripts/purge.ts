import { traceStore, TRACE_TTL_DAYS } from "@/lib/store";
import { prefsStore, PREF_TTL_MONTHS } from "@/lib/store/prefs-store";

/**
 * 保留政策的排程入口。
 *
 * Windows 工作排程器每日觸發：
 *   npx tsx scripts/purge.ts
 *
 * 輸出只有筆數與時間，不含任何個人識別資訊 —— 這份日誌本身也不該變成個資來源。
 */
async function main() {
  const n = await traceStore().purgeExpired();
  const p = await prefsStore().purgeExpired();
  console.log(
    `${new Date().toISOString()}　執行紀錄 ${n} 筆（保留 ${TRACE_TTL_DAYS} 天）、` +
      `偏好 ${p} 筆（${PREF_TTL_MONTHS} 個月未使用或已離校）`,
  );
}

main().catch((e) => {
  console.error(`清理失敗：${String(e)}`);
  process.exit(1);
});
