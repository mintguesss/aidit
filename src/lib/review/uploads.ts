import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/store/paths";
import { supabaseClient, supabaseConfigured } from "@/lib/store/supabase";

/**
 * 上傳的原始規劃表 PDF。
 *
 * 為什麼要留原檔：校對的時候要能調出「這條規則是從哪一頁抄來的」那一份。
 * 只留檔名和指紋的話，一旦有人問「你這個學分數是從哪裡看到的」，
 * 答案就只剩下一個檔名 —— 那不是證據。
 *
 * 非公開 bucket。要給人看時簽發短效連結，不直接開放。
 */

const BUCKET = "rulepack-uploads";
const UPLOAD_DIR = dataDir("rulepack-uploads");
const RECEIPT_RE = /^[0-9a-f]{12}$/;

function objectPath(receipt: string, filename: string): string {
  return `${receipt}/${filename}`;
}

export async function putUpload(receipt: string, filename: string, body: Buffer): Promise<void> {
  if (!RECEIPT_RE.test(receipt)) throw new Error(`不合法的 receipt：${receipt}`);

  if (supabaseConfigured()) {
    const db = await supabaseClient();
    const { error } = await db.storage
      .from(BUCKET)
      .upload(objectPath(receipt, filename), body, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`上傳至 ${BUCKET} 失敗：${error.message}`);
    return;
  }

  mkdirSync(UPLOAD_DIR, { recursive: true });
  writeFileSync(join(UPLOAD_DIR, `${receipt}-${filename}`), body);
}

/** 取回原檔。找不到回 null —— 呼叫端要能分辨「沒有」與「壞了」。 */
export async function getUpload(receipt: string, filename: string): Promise<Buffer | null> {
  if (!RECEIPT_RE.test(receipt)) return null;

  if (supabaseConfigured()) {
    const db = await supabaseClient();
    const { data, error } = await db.storage.from(BUCKET).download(objectPath(receipt, filename));
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  const p = join(UPLOAD_DIR, `${receipt}-${filename}`);
  return existsSync(p) ? readFileSync(p) : null;
}

/**
 * 短效下載連結（預設 5 分鐘）。
 *
 * 給校對頁用。沒有 Supabase 時回 null —— 本機模式下檔案就在磁碟上，
 * 不需要也不該憑空造一個看起來像簽名網址的東西。
 */
export async function signedUploadUrl(
  receipt: string,
  filename: string,
  expiresInSec = 300,
): Promise<string | null> {
  if (!supabaseConfigured() || !RECEIPT_RE.test(receipt)) return null;
  const db = await supabaseClient();
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(objectPath(receipt, filename), expiresInSec);
  return error ? null : (data?.signedUrl ?? null);
}
