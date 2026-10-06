import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 校對端點的密碼（TODO E2）。
 *
 * 校對能鎖規則包版本，鎖錯版等於所有人的判定依據都換掉，所以寫入要有密碼。
 * 前端在校對頁輸入、隨請求的標頭送出。
 *
 * 密碼來源：有設環境變數 AIDIT_REVIEW_PASSWORD 就用它；沒設時用下面寫死的預設密碼
 * （只存 SHA-256，不存明文）。暫時做法，之後改成環境變數或資料庫（TODO E14）。
 */

export const REVIEW_PASSWORD_HEADER = "x-review-password";

/** 預設校對密碼的 SHA-256 */
const DEFAULT_PASSWORD_SHA256 = "6d0cefe4c0ded1cd8ff2da4e69475dc5b83c7defea8f182200c5a3c18f2a0d46";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function checkReviewPassword(
  given: string | null,
  env: { password?: string } = { password: process.env.AIDIT_REVIEW_PASSWORD },
): { ok: true } | { ok: false; status: number; error: string } {
  const want = env.password?.trim() ? digest(env.password.trim()) : Buffer.from(DEFAULT_PASSWORD_SHA256, "hex");
  // 比雜湊而不是直接比字串：長度不同也不會從比較時間洩漏
  if (!given || !timingSafeEqual(digest(given), want)) {
    return { ok: false, status: 401, error: "校對密碼不對。請在頁面上方輸入校對密碼。" };
  }
  return { ok: true };
}
