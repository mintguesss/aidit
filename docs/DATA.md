# 資料盤點

這個系統實際持有哪些資料、放在哪、留多久。改動任何一列之前先看
[SPEC.md](SPEC.md) §9 與 [SPEC-CHANGES.md](SPEC-CHANGES.md) 的 E58／E60／E61。

## 一、與學生有關的

| 資料 | 現在放哪 | 落地 | 保留 | 識別性 |
|---|---|---|---|---|
| **修課紀錄** | Provider 每次重讀，不存 | **否** | 單次 request | 含學號，但從不寫出 |
| **偏好**（選課傾向） | `.data/prefs/{hash}.json`<br>Vercel 上是 `/tmp`，會蒸發 | 是 | 12 個月未用即刪 | `studentHash`＝HMAC，不可逆 |
| **額外修業目標** | 瀏覽器 localStorage；已註冊的由學籍推導 | 否 | 使用者自管 | — |
| **執行紀錄 trace** | `.data/traces/` 或 Supabase | 是 | 90 天 | `studentHash` |
| **課表** | 不存，每次由審查結果＋偏好重算；可匯出 ICS／CSV | **否** | — | — |

課表**刻意不存**。要留存的人自己匯出一份（行事曆或試算表，在瀏覽器端產生、
不經伺服器）—— 這是「不儲存」的替代方案，而不是少做一個功能。
匯出的檔案會標明節次時間與學期起訖目前都是合成資料。

「修課紀錄不落地」是 SPEC §9 的硬要求，也是為什麼情境試算與選課微調要用相同輸入
重新推導，而不是從伺服器 session 撈回來（見 [audit/session.ts](../src/lib/audit/session.ts)
的 10 分鐘快取）。

## 二、規則與參考資料（無個資）

| 資料 | 現在放哪 | 該搬去哪 |
|---|---|---|
| **規則包**（已鎖版） | `src/lib/rules/packs/*.json` | 儲存層 —— 鎖版現在會寫進原始碼目錄，serverless 上必然失敗 |
| **課綱原文語料** | `src/lib/rules/corpus/*.txt`（6 檔，約 10KB） | 儲存層，但**冷啟動預載成記憶體 Map**，不要改成 async |
| **開課資料** | `src/lib/offerings/raw.ts`（合成） | 儲存層＋抓取正規化，BACKEND.md §4 |
| **測試夾具** | `src/lib/providers/fixtures.ts`（合成） | **留在 repo**，它是 golden set 的回歸基準 |

## 三、作業紀錄

| 資料 | 現在放哪 | 備註 |
|---|---|---|
| **人工校對紀錄** | `.data/reviews/`、`.data/drafts/` | 含**校對人姓名或代號**，是承辦人員的個資 |
| **規則包上傳暫存** | `.data/rulepack-uploads/` | 原始 PDF 與檔案指紋 |
| **評測報告** | `.data/eval-report.*` | 合成資料 |

## 四、三個地方，別搞混

- **repo**：規則包、語料、開課資料、測試夾具。進版控、經 PR 審查。
- **`.data/`（或 Supabase）**：偏好、trace、校對紀錄。已 gitignore。
  Vercel 上 `.data` 指向 `/tmp`，換實例就沒了 —— 所以那些東西在線上等於不存在。
- **瀏覽器**：額外修業目標；偏好的離線備援快取（權威在伺服器，見
  [ui/sync.ts](../src/lib/ui/sync.ts)）。
