# 部署：Vercel 公開 demo

> **這份只適用於 Vercel 的公開 demo。** 家用主機跑本機模型看
> [SELFHOST.md](SELFHOST.md)；兩邊的環境變數不一樣，不要互抄。
> 各變數屬於哪一種部署，`.env.example` 開頭有對照表。


線上 Demo 跑在 Vercel。選 Vercel 而不是 GitHub Pages 的理由很單純：本專案的頁面
是 Next.js 的 async Server Component（每一頁都標了 `dynamic = "force-dynamic"`），
另外還有 12 條 API route。GitHub Pages 只供應靜態檔、不跑 server，
要放上去就得把審查引擎整個搬進瀏覽器，那是另一套系統，不是同一份程式碼。

---

## 首次部署

1. 到 <https://vercel.com/new> 匯入這個 GitHub repo。
2. Framework Preset 會自動偵測為 **Next.js**；Build Command、Output Directory
   一律保持預設，不要覆寫。
3. 設定環境變數（見下一節），至少要設 `AIDIT_DATA_DIR` 與 `AIDIT_TRACE_SECRET`。
4. Deploy。之後推上 `main` 就會自動重新部署，PR 會各自拿到一個預覽網址。

## 環境變數

欄位定義以 [`.env.example`](../.env.example) 為準，這裡只補充 Vercel 上的差異。

| 變數 | Demo 環境要不要設 | 說明 |
|---|---|---|
| `AIDIT_DATA_DIR` | **要**，設成 `/tmp/aidit` | 見下方「唯讀檔案系統」 |
| `AIDIT_TRACE_SECRET` | **要**，隨機長字串 | trace 去識別用的 HMAC 密鑰。沿用開發預設值等於任何人都能重算雜湊反推學號 |
| `AIDIT_REVIEW_PASSWORD` | 選填 | 校對頁寫入與鎖版要輸入的密碼。沒設時用程式裡寫死的預設密碼（暫時做法，TODO E14） |
| `ANTHROPIC_API_KEY` | 選填 | 不設就走確定性替身，trace 會標 `mode=offline`。Demo 給人看時建議不設，回答才每次都一樣 |
| `AIDIT_LLM_MODEL` | 選填 | 不設為 `claude-opus-5`。換模型會連定價一起換，見 `.env.example` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 選填 | 兩個都設才會啟用。不設就用檔案替身 |

> `SUPABASE_SERVICE_ROLE_KEY` 有完整的資料庫權限，只能設為 Vercel 的
> server-side 環境變數。任何時候都不要加 `NEXT_PUBLIC_` 前綴 —— 那會把它打包進
> 瀏覽器端的 JS。

## 唯讀檔案系統

沒有設定 Supabase 時，trace、偏好、校對紀錄會落到本機檔案
（[`src/lib/store/paths.ts`](../src/lib/store/paths.ts)）。Vercel 的 serverless
函式**專案目錄是唯讀的**，唯一能寫的位置是 `/tmp`，所以線上一定要設
`AIDIT_DATA_DIR=/tmp/aidit`。

`/tmp` 的語意和本機目錄不同，這點要先講清楚：

- 它隨執行實例存在，實例之間**不共用**，也不保證留存。
- 因此「執行紀錄」頁面在同一個暖實例內讀得回剛寫的 trace，但換了實例就是空的。
- 這對 Demo 夠用；要真的留存，就設定 Supabase。

## Demo 環境的已知限制

這些不是 bug，是把 Demo 放上 serverless 的必然結果，展示前先知道：

1. **執行紀錄不跨實例。** 同上。
2. **規則包鎖版寫不進去。** [`src/lib/review/store.ts`](../src/lib/review/store.ts)
   的 `PACK_DIR` / `CORPUS_DIR` 指向 `src/lib/rules/` 底下的原始碼目錄，
   線上唯讀。讀取（既有規則包、原文回查）完全正常，只有「發布鎖版」這個寫入動作會失敗。
   要修就得把已鎖版的規則包移到儲存層，那屬於後端階段的工作。
3. **審查快取各實例獨立。** `getAuditSession` 的 10 分鐘快取是 in-process 的
   Map，多實例下各存各的。判定是確定性的，所以結果一致，只是 `traceId` 會不同。

## 本機跑

```bash
npm install
npm run dev        # http://localhost:3000
```

不需要任何金鑰。全部功能（含對話、情境試算）都在離線模式下跑得完。

要接真實服務就複製 `.env.example` 成 `.env` 並填值，`.env` 已被 gitignore。
Next.js 的 `dev` 與 `build` 會自己讀它；用 tsx 直接跑的腳本（`npm run eval` 等）
則由 [`src/lib/util/env.ts`](../src/lib/util/env.ts) 載入。已存在的環境變數優先，
所以 Vercel 與 CI 上平台注入的值不會被檔案蓋掉。
