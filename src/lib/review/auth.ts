import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { supabaseClient, supabaseConfigured } from "@/lib/store/supabase";

/**
 * 校對的身分（TODO E2）。
 *
 * 校對能鎖規則包版本，鎖錯版等於所有人的判定依據都換掉，所以要登入：
 * 在 /review/login 輸入姓名與校對密碼，通過後發一個簽章過的 cookie（12 小時），
 * 之後的校對寫入以 cookie 裡的姓名記錄校對人 —— 不由頁面上的輸入框自己填。
 *
 * 密碼放哪（repo 是公開的，**密碼與雜湊都不能進 repo**）：
 *   1. 環境變數 AIDIT_REVIEW_PASSWORD（有設就用它）
 *   2. 資料庫的非公開儲存區（rulepack-uploads／_config/review-password.json），
 *      存加鹽的 scrypt 雜湊；用 scripts/set-review-password.ts 設定
 *   3. 都沒有：正式部署一律不給登入；本機開發任何非空密碼都可以
 */

export const REVIEW_COOKIE = "aidit-review";
export const REVIEW_SESSION_HOURS = 12;

const BUCKET = "rulepack-uploads";
export const PASSWORD_OBJECT = "_config/review-password.json";

type Stored = { salt: string; hash: string };
/** 測試用：直接給設定，不讀環境變數與資料庫 */
export type ReviewAuthConfig = { password?: string; stored?: Stored | null; secret?: string; production?: boolean };

const sha = (s: string) => createHash("sha256").update(s).digest();

export function hashReviewPassword(password: string, salt = randomBytes(16).toString("hex")): Stored {
  return { salt, hash: scryptSync(password, salt, 32).toString("hex") };
}

let cache: { at: number; stored: Stored | null } | null = null;
async function loadStored(): Promise<Stored | null> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.stored;
  let stored: Stored | null = null;
  if (supabaseConfigured()) {
    const { data } = await (await supabaseClient()).storage.from(BUCKET).download(PASSWORD_OBJECT);
    if (data) {
      try {
        const j = JSON.parse(await data.text()) as Stored;
        if (j.salt && j.hash) stored = j;
      } catch {
        stored = null;
      }
    }
  }
  cache = { at: Date.now(), stored };
  return stored;
}

async function configNow(): Promise<ReviewAuthConfig> {
  const password = process.env.AIDIT_REVIEW_PASSWORD?.trim() || undefined;
  return {
    password,
    stored: password ? null : await loadStored(),
    secret: process.env.AIDIT_TRACE_SECRET,
    production: process.env.NODE_ENV === "production",
  };
}

/** 這個設定的指紋：用來簽 cookie，密碼一換，舊的登入一律失效 */
function fingerprint(c: ReviewAuthConfig): string {
  if (c.password) return sha(`env|${c.password}`).toString("hex");
  if (c.stored) return `db|${c.stored.salt}|${c.stored.hash}`;
  return "dev-unset";
}

export async function checkReviewPassword(
  given: string | null,
  config?: ReviewAuthConfig,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const c = config ?? (await configNow());
  if (!given) return { ok: false, status: 401, error: "校對密碼不對。" };
  if (c.password) {
    // 比雜湊而不是直接比字串：長度不同也不會從比較時間洩漏
    return timingSafeEqual(sha(given), sha(c.password)) ? { ok: true } : { ok: false, status: 401, error: "校對密碼不對。" };
  }
  if (c.stored) {
    const got = scryptSync(given, c.stored.salt, 32);
    const want = Buffer.from(c.stored.hash, "hex");
    return got.length === want.length && timingSafeEqual(got, want)
      ? { ok: true }
      : { ok: false, status: 401, error: "校對密碼不對。" };
  }
  return c.production
    ? { ok: false, status: 503, error: "這個部署還沒設定校對密碼，校對暫停使用。" }
    : { ok: true };
}

function sessionKey(c: ReviewAuthConfig): Buffer {
  return sha(`review-session|${fingerprint(c)}|${c.secret ?? "dev"}`);
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** 登入成功後發的 cookie 值：姓名＋到期時間＋簽章 */
export async function signReviewSession(name: string, now = Date.now(), config?: ReviewAuthConfig): Promise<string> {
  const c = config ?? (await configNow());
  const payload = b64(JSON.stringify({ n: name, exp: now + REVIEW_SESSION_HOURS * 3600_000 }));
  const sig = createHmac("sha256", sessionKey(c)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** 驗證 cookie：通過回傳校對人姓名，否則 null（偽造、過期、密碼已換） */
export async function reviewerFromSession(
  token: string | undefined,
  now = Date.now(),
  config?: ReviewAuthConfig,
): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const c = config ?? (await configNow());
  const want = createHmac("sha256", sessionKey(c)).update(payload).digest();
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

/** scripts/set-review-password.ts 用：寫進資料庫的非公開儲存區 */
export async function storeReviewPassword(password: string): Promise<void> {
  const body = JSON.stringify(hashReviewPassword(password));
  const { error } = await (await supabaseClient())
    .storage.from(BUCKET)
    .upload(PASSWORD_OBJECT, new Blob([body], { type: "application/json" }), { upsert: true });
  if (error) throw new Error(`寫入校對密碼失敗：${error.message}`);
  cache = null;
}
