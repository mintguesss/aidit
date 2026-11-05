/**
 * 試用頁和系統分頁之間的通道：對話回來時把 traceId 告訴同一個瀏覽器裡開著的試用頁，
 * 主持人不用手抄。只在瀏覽器內部傳遞，沒開試用頁就沒有人收。
 */
export const TRIAL_CHANNEL = "aidit-trial";

/** 同一台裝置換下一位受試者時，清掉上一位留在瀏覽器的待確認狀態與偏好。試用草稿不動 */
export function resetSystemState(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("aidit:hold:") || key === "aidit.preferences") localStorage.removeItem(key);
    }
  } catch {
    // 瀏覽器擋住儲存時本來也沒有東西留下
  }
}

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
