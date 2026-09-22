# 後端交接

寫給接手後端的人與其 AI 助理。照順序做，前三節十分鐘讀得完。

---

## 0. 這是什麼

Aidit：畢業學分審查與修業規劃系統。核心主張是**在畢業審查場域，答錯的代價
遠高於不答** —— 優化目標為零錯答，接受較高的轉人工率。

技術上這句話是這樣落實的：判定層（學分歸屬、排課求解、引用回查）**不含任何
模型**，是確定性程式；模型只負責把自然語言轉成結構化參數，以及把結構化結果
組成人話。中間的判定沒有模型插手，而且這件事由 CI 沿 import 圖機械檢查。

前端已完成並上線。你要做的是把 mock 換成真的。

## 1. 先跑起來

```bash
npm install
npm run dev     # http://localhost:3000
npm run ci      # 送 PR 前一定要跑
```

**不需要任何 API 金鑰。** 沒有金鑰時所有模型呼叫走確定性替身，
沒有 Supabase 時資料落到本機 `.data/`。Demo、評測、注入測試、CI 全部跑得完。

`npm run ci` 是七項檢查，其中第 3、5 項有門檻（正確率不得下降、錯答須為 0、
注入攔截率不得下降）。**分數掉了就是紅燈，這是刻意的，不要調門檻來讓它過。**

## 2. 唯一不能違反的規則

以下五個模組，連同它們遞迴相依的一切，**不得 import LLM client**：

```
src/lib/audit/engine.ts      學分審查
src/lib/audit/assign.ts      學分歸屬
src/lib/solver/schedule.ts   排課求解
src/lib/solver/slots.ts      時段
src/lib/verify/citation.ts   引用回查
```

`npm run ci` 第 4 項會實際走 import 圖驗證。如果你要加進判定路徑的新模組需要
模型，那代表設計錯了 —— 模型只能出現在「自然語言 → 結構化參數」和
「結構化結果 → 人話」這兩個位置。

同一條規則的另一面：**對話介面回給使用者的每一個字都不是模型寫的**，
是 `src/lib/chat/compose.ts` 從引擎結果組出來的。改文案去改 compose，
不要調 prompt。

## 3. 三種部署，環境變數不一樣

Vercel 公開 demo、家用主機（跑本機模型）、本機開發。**各自要填的不同，
不要照抄別人那一欄。** 對照表在 [`.env.example`](.env.example) 開頭，
細節見 [docs/DEPLOY.md](docs/DEPLOY.md)（Vercel）與
[docs/SELFHOST.md](docs/SELFHOST.md)（家用主機）。

任何時候想知道「這個部署實際接到了什麼」，打 `GET /api/health`。
錯誤設定多半是**靜默**的：trace 存不進去會被 catch 掉、模型沒接上會退回替身，
頁面都不會壞 —— 從外面看一切正常，其實根本沒在用你以為的那套。

## 4. 你和前端的界線

[`docs/API.md`](docs/API.md)。只要那些形狀不變，兩邊可以完全獨立推進。
**要改形狀，先改文件再改程式，並讓對方知道。** 這是唯一會讓兩個人互相擋住的地方。

## 5. 要換掉的接縫

| 接縫 | 現在是 | 要做什麼 |
|---|---|---|
| [`src/lib/providers/`](src/lib/providers/) | `MockProvider` 讀測試案例 | 實作 `CourseRecordProvider` 接校務資料。`api` kind 目前刻意 throw（本系統不代為登入校務系統） |
| [`src/lib/store/index.ts`](src/lib/store/index.ts) | 沒憑證時走檔案替身 | `SupabaseTraceStore` **已經寫好**，資料表見 `supabase/migrations/0001_traces.sql`，跑完就生效 |
| [`src/lib/store/prefs-store.ts`](src/lib/store/prefs-store.ts) | 只有檔案實作 | **最急**。線上存到 `/tmp`，換實例就沒了 —— 使用者設定完偏好、重新整理就不見 |
| [`src/lib/rules/`](src/lib/rules/) | 語料與規則包是 repo 裡的檔案 | 搬到儲存層。鎖版現在會寫進 `src/lib/rules/packs/` 這個**原始碼目錄**，serverless 上唯讀，必然失敗 |
| [`src/lib/offerings/`](src/lib/offerings/) | 合成開課資料 | 抓取與正規化，BACKEND.md §4 |

## 6. 動工前要先談的一件事

`fixture` 這個查詢參數現在同時扮演「選哪份測試案例」和「選哪個學生」。
接上真實資料源後這兩件事會分家，而它牽動 `docs/API.md` 裡大部分端點。
**先跟前端談定再動。**

## 7. 明確不要做的事

這幾項都是看起來合理、但會拆掉這個系統支柱的做法：

- **不要把 `src/lib/providers/fixtures.ts` 搬進資料庫。** 那是 golden set 的
  回歸基準（35 個案例），CI 第 3 項就是拿它算的。放進資料庫等於讓基準變成
  可被人隨手改的東西，「零錯答」的機械保證就沒了。測試夾具屬於版控。

- **語料搬進資料庫時，不要把 `loadCorpus()` 改成 async。** 它和
  `citationVerify()` 目前都是同步的，改 async 會一路傳染到審查引擎。
  正解是**冷啟動時預載成記憶體 Map**，保持同步介面。現在全部語料才 10KB，
  擴到幾百個系所也才幾 MB，預載完全撐得住。
  好消息是 `verifyAll(citations, corpus)` 是純函式、語料用參數傳，
  所以只要改 loader，判定層一行都不用動。

- **`SUPABASE_SERVICE_ROLE_KEY` 絕對不要加 `NEXT_PUBLIC_` 前綴。**
  它繞過 RLS、有完整資料庫權限，加了前綴會被打包進瀏覽器端 JS。

- **不要提交任何真實學生資料**，一筆都不行。測試一律用合成資料。

- **不要為了讓 CI 過而放寬門檻。** 第 3、5 項掉分代表判定品質退步了。

## 8. 交付前

```bash
npm run ci      # 七項全過
npm run build   # production build 建得起來
```

PR 會自動跑同樣的檢查（`.github/workflows/ci.yml`）。跨界的改動
（`docs/API.md`、`src/lib/types.ts`、`src/app/api/`）在 PR 描述裡明講。

## 9. 讀碼順序

1. [README.md](README.md) §架構 —— 十分鐘看懂資料怎麼流
2. [BACKEND.md](BACKEND.md) §1 學分歸屬 —— **先讀這個**
3. [docs/API.md](docs/API.md) —— 你和前端的合約
4. [SPEC.md](SPEC.md) §9 —— 隱私邊界，解釋了為什麼很多東西刻意不存伺服器
5. [CONTRIBUTING.md](CONTRIBUTING.md) —— 分支、PR、CI 的規則

BACKEND.md §1 講的是：一門課可能同時符合多個類別，貪婪指派會產生**假的未修**，
讓一個本來能畢業的學生多讀一學期。那是這個系統最不能犯的錯，也是
`src/lib/audit/assign.ts` 為什麼要做回溯搜尋而不是直接塞。
