import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase 連線的共用入口。
 *
 * 各個 store（trace、偏好、規則包、校對紀錄）都要連同一個資料庫，
 * 連線細節只該寫一次 —— 尤其是下面那段 WebSocket 的處理，
 * 散在四個地方的話，之後只會修好其中一兩個。
 */

/** 兩個都設定才算數：少一個就退回檔案替身，而那是靜默的 */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let client: SupabaseClient | null = null;

export async function supabaseClient(): Promise<SupabaseClient> {
  if (client) return client;

  // supabase-js 的 Realtime 需要全域 WebSocket，而 Node 22 之前沒有。
  // 本專案一次 Realtime 都沒用到（只有 PostgREST 的 from().select/insert/delete），
  // 但 client 建構時就會檢查，所以在 Node 20 上得先補上。
  if (typeof globalThis.WebSocket === "undefined") {
    const ws = await import("ws");
    (globalThis as { WebSocket?: unknown }).WebSocket = ws.default;
  }

  const { createClient } = await import("@supabase/supabase-js");
  client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  return client;
}
