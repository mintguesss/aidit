/**
 * 試用頁和系統分頁之間的通道：對話回來時把 traceId 告訴同一個瀏覽器裡開著的試用頁，
 * 主持人不用手抄。只在瀏覽器內部傳遞，沒開試用頁就沒有人收。
 */
export const TRIAL_CHANNEL = "aidit-trial";

export function announceTrace(traceId: string | undefined): void {
  if (!traceId || typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(TRIAL_CHANNEL);
    ch.postMessage({ traceId });
    ch.close();
  } catch {
    // 瀏覽器不支援或被擋：少記一個 traceId，不影響對話
  }
}
