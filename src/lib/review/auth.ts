import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 校對端點的密碼（TODO E2）。
 *
 * 校對能鎖規則包版本，鎖錯版等於所有人的判定依據都換掉，所以寫入要有密碼。
 * 密碼放在環境變數 AIDIT_REVIEW_PASSWORD，前端在校對頁輸入、隨請求的標頭送出。
 * 正式部署沒設密碼時一律拒絕（寧可校對頁不能用，也不要誰都能鎖版）；
 * 本機開發沒設就不檢查。
 */

export const REVIEW_PASSWORD_HEADER = "x-review-password";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function checkReviewPassword(
  given: string | null,
  env: { password?: string; production: boolean } = {
    password: process.env.AIDIT_REVIEW_PASSWORD,
    production: process.env.NODE_ENV === "production",
  },
): { ok: true } | { ok: false; status: number; error: string } {
  const want = env.password?.trim();
  if (!want) {
    return env.production
      ? { ok: false, status: 503, error: "這個部署沒有設定校對密碼（AIDIT_REVIEW_PASSWORD），校對暫停使用。" }
      : { ok: true };
  }
  // 比雜湊而不是直接比字串：長度不同也不會從比較時間洩漏
  if (!given || !timingSafeEqual(digest(given), digest(want))) {
    return { ok: false, status: 401, error: "校對密碼不對。請在頁面上方輸入校對密碼。" };
  }
  return { ok: true };
}
