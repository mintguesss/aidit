# 開發與協作

給接手後端的人：先讀這份，再讀 [BACKEND.md](BACKEND.md)。前三節十分鐘讀得完，
可以少走很多冤枉路。

---

## 1. 先跑起來

```bash
npm install
npm run dev     # http://localhost:3000
npm run ci      # 送 PR 前跑這個
```

**不需要任何 API 金鑰。** 沒有 `ANTHROPIC_API_KEY` 時，所有用到模型的地方都會走
確定性替身，trace 會標 `mode=offline`；沒有 Supabase 時，資料落到本機 `.data/`。
Demo、評測、注入測試、CI 全部在離線模式下跑得完。

唯一的例外是規則抽取（`npm run rulepack:extract`），它沒有替身，必須有金鑰。

要接真實服務就複製 `.env.example` 成 `.env`，填哪個就啟用哪個，沒有「填一半」的
中間狀態。

## 2. 這個專案最重要的一條規則

**算數的那層不准碰模型。** 以下五個模組，連同它們遞迴相依的一切，都不得 import
LLM client：

```
src/lib/audit/engine.ts      學分審查
src/lib/audit/assign.ts      學分歸屬（指派問題）
src/lib/solver/schedule.ts   排課求解
src/lib/solver/slots.ts      時段
src/lib/verify/citation.ts   引用回查
```

這不是口頭約定，`npm run ci` 的第 4 項會沿著 import 圖實際走一遍，違反就紅燈
（[scripts/lib/checks.ts](scripts/lib/checks.ts)）。加新模組進判定路徑時，
如果它需要模型，那代表設計錯了 —— 模型只能出現在「把自然語言變成結構化參數」
和「把結構化衝突變成人話」這兩個位置，中間的判定必須是確定性的。

同一條規則的另一面：**對話介面回給使用者的每一個字都不是模型寫的**，
而是 `src/lib/chat/compose.ts` 從引擎結果組出來的。改回覆文案要去改 compose，
不是去調 prompt。

## 3. 分工切面

前後端的分界線是 [docs/API.md](docs/API.md)。只要那些形狀不變，兩邊可以完全獨立
推進。要改形狀，**先改文件再改程式，並讓對方知道** —— 這是唯一會讓兩個人互相
擋住的地方。

目前 mock 與真實實作的接縫已經開好，後端主要是把替身換掉：

| 接縫 | 現在是 | 換成真的要做什麼 |
|---|---|---|
| [`src/lib/providers/`](src/lib/providers/) | `MockProvider` 讀測試案例 | 實作 `CourseRecordProvider` 介面接校務資料；`api` kind 目前刻意 throw |
| [`src/lib/store/index.ts`](src/lib/store/index.ts) | 沒憑證時走檔案替身 | `TraceStore` 介面的 Supabase 實作已在同檔，補齊四張表 |
| [`src/lib/offerings/`](src/lib/offerings/) | 合成開課資料 | 抓取與正規化，見 BACKEND.md §4 |
| [`src/lib/rules/packs/`](src/lib/rules/) | 已鎖版的 `im-111.json` | PDF → 抽取 → 驗證 → 人工校對流程，見 BACKEND.md §2 |
| [`src/lib/llm/client.ts`](src/lib/llm/client.ts) | 無金鑰時確定性替身 | 已可用，只是要注意預算上限 |

**還沒決定、需要一起討論的第一件事**：後端接上真實資料源之後，
`fixture` 這個查詢參數的角色要變成什麼。它現在同時扮演「選哪份測試案例」與
「選哪個學生」，接真實資料後這兩件事會分家。這牽動 `docs/API.md` 裡大部分端點，
所以動工前先談。

## 4. 分支與 PR

- `main` 永遠可部署。Vercel 盯著 `main`，推上去就上線。
- 開 `feat/…`、`fix/…`、`docs/…` 分支，一律經 PR 併入。
- PR 會跑 [CI](.github/workflows/ci.yml)：`npm run ci` 加一次 production build，
  七項檢查全過才准併。Vercel 也會給每個 PR 一個預覽網址。
- 前後端各自的區域盡量不互相動；跨界的改動（`docs/API.md`、`src/lib/types.ts`、
  `src/app/api/`）在 PR 描述裡明講。

送 PR 前跑 `npm run ci`。它涵蓋：

1. 不變式與 golden set 回歸（vitest，181 個測試）
2. 型別檢查
3. 評測回歸 —— **正確率不得下降、錯答須為 0**
4. 模組邊界（見第 2 節）
5. 注入測試 —— 攔截率與誤攔率不得下降
6. 原始碼與設定檔不得含金鑰或真實學號
7. 規則包 schema 與自動驗證

第 3、5 項是有門檻的回歸檢查，不是跑完就算。分數掉了 CI 就紅，這是刻意的。

## 5. 不要提交的東西

`.gitignore` 已經擋掉 `.env`、`.data/`、`node_modules/`、`.next/`。另外：

- **任何真實學生資料**，一筆都不行。測試案例一律用
  [`src/lib/providers/fixtures.ts`](src/lib/providers/fixtures.ts) 裡的合成資料。
- **金鑰**。`npm run ci` 有掃描（`scanSecrets`），但別依賴它 —— 它是最後一道，
  不是第一道。
- `SUPABASE_SERVICE_ROLE_KEY` 有完整資料庫權限，任何情況下都不要加
  `NEXT_PUBLIC_` 前綴。

## 6. 讀碼順序

1. [README.md](README.md) §架構 —— 十分鐘看懂資料怎麼流
2. [BACKEND.md](BACKEND.md) §1 學分歸屬 —— 全專案最容易算錯的地方，**先讀這個**
3. [docs/API.md](docs/API.md) —— 你和前端的合約
4. [SPEC.md](SPEC.md) §9 —— 隱私邊界，決定了為什麼很多東西刻意不存伺服器
5. [CONVERSATION.md](CONVERSATION.md) —— 只在你要碰對話路徑時才需要

BACKEND.md §1 講的是：一門課可能同時符合多個類別，貪婪指派會產生**假的未修**，
讓一個本來能畢業的學生多讀一學期。那是這個系統最不能犯的錯，也是
`src/lib/audit/assign.ts` 為什麼要做回溯搜尋而不是直接塞。
