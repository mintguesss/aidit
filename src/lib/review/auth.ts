import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * 校對的身分（TODO E2）。
 *
 * 校對能鎖規則包版本，鎖錯版等於所有人的判定依據都換掉，所以要登入：
 * 在 /review/login 輸入姓名與校對密碼，通過後發一個簽章過的 cookie（12 小時），
 * 之後的校對寫入以 cookie 裡的姓名記錄校對人 —— 不再由頁面上的輸入框自己填。
 *
 * 密碼來源：有設環境變數 AIDIT_REVIEW_PASSWORD 就用它；沒設時用下面寫死的預設密碼
 * （只存 SHA-256，不存明文）。暫時做法，之後改成環境變數或資料庫（TODO E14）。
 */

export const REVIEW_COOKIE = "aidit-review";
export const REVIEW_SESSION_HOURS = 12;

/** 預設校對密碼的 SHA-256 */
const DEFAULT_PASSWORD_SHA256 = "6d0cefe4c0ded1cd8ff2da4e69475dc5b83c7defea8f182200c5a3c18f2a0d46";

const digest = (s: string) => createHash("sha256").update(s).digest();

type Env = { password?: string; secret?: string };
const envNow = (): Env => ({ password: process.env.AIDIT_REVIEW_PASSWORD, secret: process.env.AIDIT_TRACE_SECRET });

function wantDigest(env: Env): Buffer {
  return env.password?.trim() ? digest(env.password.trim()) : Buffer.from(DEFAULT_PASSWORD_SHA256, "hex");
}

export function checkReviewPassword(
  given: string | null,
  env: Env = envNow(),
): { ok: true } | { ok: false; status: number; error: string } {
  // 比雜湊而不是直接比字串：長度不同也不會從比較時間洩漏
  if (!given || !timingSafeEqual(digest(given), wantDigest(env))) {
    return { ok: false, status: 401, error: "校對密碼不對。" };
  }
  return { ok: true };
}

/** 簽章金鑰：密碼一換，舊的登入一律失效 */
function sessionKey(env: Env): Buffer {
  return digest(`review-session|${wantDigest(env).toString("hex")}|${env.secret ?? "dev"}`);
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** 登入成功後發的 cookie 值：姓名＋到期時間＋簽章 */
export function signReviewSession(name: string, now = Date.now(), env: Env = envNow()): string {
  const payload = b64(JSON.stringify({ n: name, exp: now + REVIEW_SESSION_HOURS * 3600_000 }));
  const sig = createHmac("sha256", sessionKey(env)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** 驗證 cookie：通過回傳校對人姓名，否則 null（偽造、過期、密碼已換） */
export function reviewerFromSession(token: string | undefined, now = Date.now(), env: Env = envNow()): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = createHmac("sha256", sessionKey(env)).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { n, exp } = JSON.parse(unb64(payload)) as { n?: unknown; exp?: unknown };
    if (typeof n !== "string" || !n.trim() || typeof exp !== "number" || exp < now) return null;
    return n;
  } catch {
    return null;
  }
}
