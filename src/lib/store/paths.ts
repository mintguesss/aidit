import { join } from "node:path";

/**
 * 檔案替身的根目錄。
 *
 * 本機預設 `<專案>/.data`。但 serverless 平台（Vercel）的專案目錄是唯讀的，
 * 唯一可寫的位置是 `/tmp`，因此改成可用 `AIDIT_DATA_DIR` 指定。
 *
 * 要注意 `/tmp` 的語意跟本機目錄不一樣：它隨執行實例存在，實例之間不共用、
 * 也不保證留存。這對 Demo 夠用（同一個暖實例內讀得回自己寫的 trace），
 * 但不是儲存 —— 要真的留存就得設定 Supabase，見 .env.example。
 */
export function dataDir(...segments: string[]): string {
  const root = process.env.AIDIT_DATA_DIR || join(process.cwd(), ".data");
  return join(root, ...segments);
}
