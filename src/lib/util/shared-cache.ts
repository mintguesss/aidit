import { unstable_cache } from "next/cache";

/**
 * 跨執行個體共用的快取（Vercel 的資料快取）。不在 Next 的執行環境裡（單元測試、腳本）就直接算。
 *
 * Vercel 每一頁各自是一個函式，剛部署或閒置後每個新執行個體都要從 Supabase 重新載入規則包、
 * 開課資料、重跑審查。放進這裡的東西第一個執行個體算完，其他的直接讀。
 * 值必須是純 JSON（Map、Set 會在存取時變形）。單一項目上限約 2 MB，大的資料要拆開存。
 */
export async function shared<T>(key: string[], ttlSeconds: number, load: () => Promise<T>, tags: string[] = []): Promise<T> {
  try {
    return await unstable_cache(load, key, { revalidate: ttlSeconds, tags })();
  } catch (e) {
    if (!/incrementalCache|static generation store|outside of a request|cookies|headers/i.test(String(e))) {
      console.warn(`[aidit][cache] 共用快取 ${key.join(":")} 失敗，直接載入：${String(e)}`);
    }
    return load();
  }
}
