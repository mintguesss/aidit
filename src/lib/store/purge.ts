import { traceStore, TRACE_TTL_DAYS } from "./index";
import { prefsStore, PREF_TTL_MONTHS } from "./prefs-store";

/**
 * 每日一次的 trace 清理。
 *
 * `purgeExpired()` 本來就寫好了，但**從來沒有人呼叫它** ——
 * 「保留 90 天」等於只是一句寫在型別旁邊的註解。保留政策要成立，
 * 就必須真的有東西去執行它。
 *
 * 這裡用「每次請求檢查一次，24 小時內只跑一次」的作法，
 * 而不是背景計時器：Next.js 的 serverless／熱重載環境不保證計時器活著，
 * 而只要有人用這個系統，就一定會有請求。真正的排程器可改用
 * `npx tsx scripts/purge.ts`（Windows 工作排程器每日觸發）。
 *
 * 日誌只記筆數與時間，不含任何個人識別資訊。
 */

const DAY_MS = 24 * 3600 * 1000;
let lastRun = 0;
let running: Promise<number> | null = null;

export async function purgeDaily(): Promise<number> {
  const now = Date.now();
  if (now - lastRun < DAY_MS) return 0;
  if (running) return running;

  lastRun = now;
  running = (async () => {
    try {
      const n = await traceStore().purgeExpired();
      const p = await prefsStore().purgeExpired();
      if (n > 0 || p > 0) {
        console.info(
          `[aidit][retention] ${new Date().toISOString()} ` +
            `執行紀錄 ${n} 筆（保留 ${TRACE_TTL_DAYS} 天）、` +
            `偏好 ${p} 筆（${PREF_TTL_MONTHS} 個月未使用或已離校）`,
        );
      }
      return n + p;
    } catch (e) {
      console.warn(`[aidit][retention] 清理失敗：${String(e)}`);
      return 0;
    } finally {
      running = null;
    }
  })();
  return running;
}
