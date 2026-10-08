// 必須排在其他 import 之前：下面的模組在載入時就會讀 process.env
import "@/lib/util/env";

/**
 * 設定校對登入密碼（lib/review/auth.ts）：存成加鹽的 scrypt 雜湊，放在資料庫的非公開儲存區，
 * 不進 repo、不用改 Vercel 環境變數。改了之後所有人的校對登入都會失效，要重新登入。
 *
 *   npx tsx scripts/set-review-password.ts        然後輸入新密碼（不會顯示在畫面上以外的地方）
 *
 * 密碼至少 10 個字：repo 是公開的，登入端點雖有速率限制，太短的密碼仍然猜得到。
 */
import { createInterface } from "node:readline";
import { supabaseConfigured } from "@/lib/store/supabase";
import { storeReviewPassword } from "@/lib/review/auth";

async function main() {
  if (!supabaseConfigured()) {
    console.error("沒有設定 Supabase（.env 的 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY）。");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await new Promise<string>((r) => rl.question("新的校對密碼（至少 10 個字）：", (a) => r(a.trim())));
  rl.close();
  if (pw.length < 10) {
    console.error("太短了：至少 10 個字。");
    process.exit(1);
  }
  await storeReviewPassword(pw);
  console.log("已設定。網站 5 分鐘內生效；所有人的校對登入都要重新登入。");
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
