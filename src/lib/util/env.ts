import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 從 .env 載入環境變數（本機開發用）。
 *
 * Next.js 的 dev 與 build 會自己讀 .env，所以網頁端不需要這個檔；
 * 但用 tsx 直接跑的腳本（評測、規則抽取、清理）不會，沒有它就永遠是離線模式。
 *
 * Node 20.18 之前沒有 --env-file-if-exists，直接在 npm script 加 --env-file=.env
 * 會讓沒有 .env 的環境（例如 CI）整個跑不起來，所以自己讀。
 *
 * 已存在的環境變數優先：CI 與 Vercel 是從平台注入的，不該被檔案蓋掉。
 */
export function loadEnvFile(path = join(process.cwd(), ".env")): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;

    const eq = t.indexOf("=");
    if (eq <= 0) continue;

    const key = t.slice(0, eq).trim();
    if (key in process.env) continue;

    let value = t.slice(eq + 1).trim();
    // 去掉包住整個值的引號；值裡面的引號要留著
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();
