# 資料盤點

這個系統實際持有哪些資料、放在哪、留多久。改動任何一列之前先看
[SPEC.md](SPEC.md) §9 與 [SPEC-CHANGES.md](SPEC-CHANGES.md) 的 E58／E60／E61。

## 一、與學生有關的

| 資料 | 現在放哪 | 落地 | 保留 | 識別性 |
|---|---|---|---|---|
| **修課紀錄** | Provider 每次重讀，不存 | **否** | 單次 request | 含學號，但從不寫出 |
| **偏好**（選課傾向） | Supabase `preferences`；沒設定時 `.data/prefs/{hash}.json` | 是 | 12 個月未用即刪 | `studentHash`＝HMAC，不可逆 |
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
| **規則包**（已鎖版） | 合成的在 `src/lib/rules/packs/*.json`；校對鎖版的發布到 Supabase `rule_packs` | 已搬（沒設 Supabase 時仍寫進 `packs/`） |
| **課綱原文語料** | `src/lib/rules/corpus/*.txt`（6 檔，約 10KB） | 儲存層，但**冷啟動預載成記憶體 Map**，不要改成 async |
| **開課資料** | `src/lib/offerings/raw.ts`（合成） | 儲存層＋抓取正規化，BACKEND.md §4 |
| **測試夾具** | `src/lib/providers/fixtures.ts`（合成） | **留在 repo**，它是 golden set 的回歸基準 |
| **輔大資管規則包草稿** | 草稿儲存層（`rulepack_drafts`）；副本在 `docs/review/` | 真實規則，校對鎖版前不用於判定 |
| **輔大原文語料** | `src/lib/rules/corpus/fju-im-*.txt` | 公開文件，引用回查用 |
| **輔大開課資料** | `src/lib/offerings/data/fju-115-2.json`（抽取結果與問題清單在 `docs/review/`） | 系上公開課表抽出；**沒有修課人數**（只有教務處系統有），餘額顯示為未知 |

## 三、作業紀錄

| 資料 | 現在放哪 | 備註 |
|---|---|---|
| **人工校對紀錄** | `review_records` 或 `.data/reviews/` | 含**校對人姓名或代號**，是承辦人員的個資 |
| **規則包草稿與語料** | `rulepack_drafts` 或 `.data/drafts/` | 抽取在本機、校對在線上，兩者必須存在一起 |
| **上傳的原始 PDF** | Supabase Storage（非公開）或 `.data/rulepack-uploads/` | 中繼資料另存 `rulepack_uploads` |
| **評測報告** | `.data/eval-report.*` | 合成資料 |

## 四、三個地方，別搞混

- **repo**：規則包、語料、開課資料、測試夾具。進版控、經 PR 審查。
- **`.data/`（或 Supabase）**：偏好、trace、校對紀錄。已 gitignore。
  Vercel 上 `.data` 指向 `/tmp`，換實例就沒了 —— 所以那些東西在線上等於不存在。
- **瀏覽器**：額外修業目標；偏好的離線備援快取（權威在伺服器，見
  [ui/sync.ts](../src/lib/ui/sync.ts)）。
