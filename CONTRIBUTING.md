# 開發與協作

這份是**常駐規則**，任何人參與開發都適用。
要接手後端的人另看 [docs/HANDOVER.md](docs/HANDOVER.md)（短，講你的任務）。

---

## 1. 先跑起來

```bash
npm install
npm run dev     # http://localhost:3000
npm run ci      # 送 PR 前跑這個
```

**不需要任何 API 金鑰。** 沒有 `ANTHROPIC_API_KEY` 時所有模型呼叫走確定性替身，
trace 會標 `mode=offline`；沒有 Supabase 時資料落到本機 `.data/`。
Demo、評測、注入測試、CI 全部在離線模式下跑得完。

唯一例外是規則抽取（`npm run rulepack:extract`），它沒有替身，必須有金鑰。

## 2. 這個專案最重要的一條規則

**算數的那層不准碰模型。** 以下五個模組，連同它們遞迴相依的一切，都不得
import LLM client：

```
src/lib/audit/engine.ts      學分審查
src/lib/audit/assign.ts      學分歸屬（指派問題）
src/lib/solver/schedule.ts   排課求解
src/lib/solver/slots.ts      時段
src/lib/verify/citation.ts   引用回查
```

這不是口頭約定，`npm run ci` 第 4 項會沿 import 圖實際走一遍
（[scripts/lib/checks.ts](scripts/lib/checks.ts)）。加新模組進判定路徑時，
如果它需要模型，那代表設計錯了 —— 模型只能出現在「自然語言 → 結構化參數」
和「結構化結果 → 人話」這兩個位置，中間的判定必須是確定性的。

同一條規則的另一面：**對話介面回給使用者的每一個字都不是模型寫的**，
而是 [src/lib/chat/compose.ts](src/lib/chat/compose.ts) 從引擎結果組出來的。
改回覆文案要去改 compose，不是去調 prompt。

## 3. 三種部署，環境變數不一樣

Vercel 公開 demo、家用主機（跑本機模型）、本機開發。**各自要填的不同，
不要照抄別人那一欄。** 對照表在 [.env.example](.env.example) 開頭。

想知道「這個部署實際接到了什麼」就打 `GET /api/health`。錯誤設定多半是
**靜默**的：trace 存不進去會被 catch 掉、模型沒接上會退回替身，頁面都不會壞
—— 從外面看一切正常，其實根本沒在用你以為的那套。

## 4. 前後端分界線

[docs/API.md](docs/API.md)。只要那些形狀不變，兩邊可以完全獨立推進。
要改形狀，**先改文件再改程式，並讓對方知道** —— 這是唯一會讓兩個人互相
擋住的地方。

目前 mock 與真實實作的接縫：

| 接縫 | 現在是 | 換成真的要做什麼 |
|---|---|---|
| [providers/](src/lib/providers/) | `MockProvider` 讀測試案例 | 實作 `CourseRecordProvider` 接校務資料；`api` kind 目前刻意 throw |
| [store/index.ts](src/lib/store/index.ts) | 沒憑證時走檔案替身 | `SupabaseTraceStore` 已寫好，跑 `supabase/migrations/` 就生效 |
| [store/prefs-store.ts](src/lib/store/prefs-store.ts) | 只有檔案實作 | **最急**：線上存到 `/tmp`，換實例就沒了 |
| [rules/](src/lib/rules/) | 語料與規則包是 repo 裡的檔案 | 搬到儲存層；鎖版現在會寫進原始碼目錄，serverless 上必然失敗 |
| [offerings/](src/lib/offerings/) | 合成開課資料 | 抓取與正規化，docs/BACKEND.md §4 |

## 5. 分支與 PR

- `main` 永遠可部署。Vercel 盯著 `main`，推上去就上線。
- 開 `feat/…`、`fix/…`、`docs/…` 分支，一律經 PR 併入。
- PR 會跑 [CI](.github/workflows/ci.yml)：`npm run ci` 加一次 production build。
- 跨界的改動（`docs/API.md`、`src/lib/types.ts`、`src/app/api/`）在 PR 描述裡明講。

`npm run ci` 的七項：

1. 不變式與 golden set 回歸（vitest，351 個測試）
2. 型別檢查
3. 評測回歸 —— **正確率不得下降、錯答須為 0**
4. 模組邊界（見第 2 節）
5. 注入測試 —— 攔截率與誤攔率不得下降
6. 原始碼與設定檔不得含金鑰或真實學號
7. 規則包 schema 與自動驗證

第 3、5 項是有門檻的回歸檢查，不是跑完就算。分數掉了 CI 就紅，這是刻意的。

## 6. 不要做的事

這幾項都是看起來合理、但會拆掉這個系統支柱的做法：

- **不要把 [providers/fixtures.ts](src/lib/providers/fixtures.ts) 搬進資料庫。**
  那是 golden set 的回歸基準（35 個案例），CI 第 3 項就是拿它算的。
  放進資料庫等於讓基準變成可被人隨手改的東西，「零錯答」的機械保證就沒了。
  測試夾具屬於版控。

- **語料搬進資料庫時，不要把 `loadCorpus()` 改成 async。** 它和
  `citationVerify()` 目前都是同步的，改 async 會一路傳染到審查引擎。
  正解是**冷啟動時預載成記憶體 Map**，保持同步介面 —— 全部語料才 10KB，
  擴到幾百個系所也才幾 MB。好消息是 `verifyAll(citations, corpus)` 是純函式、
  語料用參數傳，所以只要改 loader，判定層一行都不用動。

- **`SUPABASE_SERVICE_ROLE_KEY` 絕對不要加 `NEXT_PUBLIC_` 前綴。**
  它繞過 RLS、有完整資料庫權限，加了前綴會被打包進瀏覽器端 JS。

- **不要提交任何真實學生資料**，一筆都不行。測試一律用
  [fixtures.ts](src/lib/providers/fixtures.ts) 裡的合成資料。
  金鑰同理 —— CI 第 6 項有掃描，但那是最後一道，不是第一道。

- **不要為了讓 CI 過而放寬門檻。** 第 3、5 項掉分代表判定品質退步了。

## 7. 讀碼順序

1. [README.md](README.md) §架構 —— 十分鐘看懂資料怎麼流
2. [docs/BACKEND.md](docs/BACKEND.md) §1 學分歸屬 —— 全專案最容易算錯的地方，**先讀這個**
3. [docs/API.md](docs/API.md) —— 你和另一邊的合約
4. [docs/SPEC.md](docs/SPEC.md) §9 —— 隱私邊界，決定了為什麼很多東西刻意不存伺服器
5. [docs/CONVERSATION.md](docs/CONVERSATION.md) —— 只在你要碰對話路徑時才需要

docs/BACKEND.md §1 講的是：一門課可能同時符合多個類別，貪婪指派會產生**假的未修**，
讓一個本來能畢業的學生多讀一學期。那是這個系統最不能犯的錯，也是
[audit/assign.ts](src/lib/audit/assign.ts) 為什麼要做回溯搜尋而不是直接塞。
