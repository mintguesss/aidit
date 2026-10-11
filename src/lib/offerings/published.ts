import { supabaseClient, supabaseConfigured } from "@/lib/store/supabase";
import { setPublishedOfferings, type RawOffering } from "./index";

/**
 * 資料庫裡的開課資料（supabase/migrations/0004_offerings.sql）。
 *
 * 一學期一列。同一學期 repo 裡也有的話，以資料庫為準（見 offerings/index.ts 的 rawOfferings）。
 *
 * **讀取刻意保持同步介面**：offeringsFor() 在排課、搜尋、對話裡到處是同步呼叫，
 * 改成 async 會一路傳染。所以跟規則包一樣，在非同步的入口點（getAuditSession）先載入記憶體。
 */

export type OfferingSnapshot = {
  school: string;
  year: number;
  term: 1 | 2;
  rows: RawOffering[];
  source: string;
  fetchedAt: string;
};

const TTL_MS = 10 * 60 * 1000;
let loadedAt = 0;

/**
 * 從資料庫載入開課資料。沒設定 Supabase 時是 no-op。
 * 失敗（還沒建表、連不上）不中斷 —— repo 裡的檔案照樣可用，只是看不到新上傳的學期。
 */
export async function preloadOfferings(force = false): Promise<void> {
  if (!supabaseConfigured()) return;
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  try {
    // 跨執行個體共用快取：學期清單一項、每學期一項（全部加起來約 1.4 MB，單一項目有 2 MB 上限，所以拆開）
    const { shared } = await import("@/lib/util/shared-cache");
    const ttl = TTL_MS / 1000;
    const terms = await shared(["offering-terms"], ttl, async () => {
      const db = await supabaseClient();
      const { data, error } = await db.from("offerings").select("school, year, term");
      if (error) throw new Error(error.message);
      return (data ?? []) as { school: string; year: number; term: number }[];
    });
    const data = await Promise.all(
      terms.map((t) =>
        shared(["offerings", t.school, String(t.year), String(t.term)], ttl, async () => {
          const db = await supabaseClient();
          const { data, error } = await db
            .from("offerings")
            .select("school, year, term, rows")
            .eq("school", t.school)
            .eq("year", t.year)
            .eq("term", t.term)
            .single();
          if (error) throw new Error(error.message);
          return data as { school: string; year: number; term: number; rows: RawOffering[] };
        }),
      ),
    );
    const rows: RawOffering[] = [];
    for (const r of data) {
      // 每一列的學校、學年、學期以這一學期的欄位為準，避免上傳的檔案內容與欄位對不上
      for (const o of r.rows) rows.push({ ...o, school: r.school, year: r.year, term: r.term as 1 | 2 });
    }
    setPublishedOfferings(rows);
  } catch (e) {
    console.warn(`[aidit][offerings] 讀取資料庫開課資料失敗，改用 repo 版本：${String(e)}`);
  } finally {
    loadedAt = Date.now();
  }
}

/** 上傳一學期的開課資料（整學期取代）。scripts/push-offerings.ts 用 */
export async function publishOfferings(s: OfferingSnapshot): Promise<void> {
  const db = await supabaseClient();
  const { error } = await db.from("offerings").upsert({
    school: s.school,
    year: s.year,
    term: s.term,
    rows: s.rows,
    source: s.source,
    fetched_at: s.fetchedAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`寫入 offerings 失敗：${error.message}`);
}

/** 資料庫裡有哪些學期（給上傳腳本列出現況） */
export async function listPublishedTerms(): Promise<{ school: string; year: number; term: number; count: number }[]> {
  const db = await supabaseClient();
  const { data, error } = await db.from("offerings").select("school, year, term, rows");
  if (error) throw new Error(`讀取 offerings 失敗：${error.message}`);
  return ((data ?? []) as { school: string; year: number; term: number; rows: unknown[] }[]).map((r) => ({
    school: r.school,
    year: r.year,
    term: r.term,
    count: r.rows.length,
  }));
}
