import { createHash } from "node:crypto";
import { supabaseClient, supabaseConfigured } from "@/lib/store/supabase";

/**
 * 公告適用判斷（rule.reconcile）的快取。
 *
 * 判斷只取決於公告全文、這一則的適用段落、入學年度、系所、學制、提示詞與模型 ——
 * 同一組輸入問模型幾次答案都該一樣，所以問過一次就存起來。
 * 先查記憶體，再查資料庫的非公開儲存區（Vercel 的執行個體隨時重開，只放記憶體等於沒存）。
 * 存的只有判斷結果與引句，不含學生任何資料。
 */

export type CachedReconcile = { resolved: boolean; appliesToStudent: boolean | null; reason: string; quote: string };

const BUCKET = "rulepack-uploads";
const memory = new Map<string, CachedReconcile>();

export function reconcileKey(parts: (string | number)[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
}

const objectOf = (key: string) => `_cache/reconcile/${key}.json`;

export async function readReconcileCache(key: string): Promise<CachedReconcile | null> {
  const m = memory.get(key);
  if (m) return m;
  if (!supabaseConfigured()) return null;
  try {
    const { data } = await (await supabaseClient()).storage.from(BUCKET).download(objectOf(key));
    if (!data) return null;
    const v = JSON.parse(await data.text()) as CachedReconcile;
    if (typeof v.resolved !== "boolean" || typeof v.reason !== "string" || typeof v.quote !== "string") return null;
    memory.set(key, v);
    return v;
  } catch {
    // 讀不到快取不是錯誤，照常問模型
    return null;
  }
}

export async function writeReconcileCache(key: string, v: CachedReconcile): Promise<void> {
  memory.set(key, v);
  if (!supabaseConfigured()) return;
  try {
    await (await supabaseClient())
      .storage.from(BUCKET)
      .upload(objectOf(key), new Blob([JSON.stringify(v)], { type: "application/json" }), { upsert: true });
  } catch {
    // 寫不進去只是下次再問一次，不影響這次的判斷
  }
}
