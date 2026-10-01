# 規則與資料的人工校對

真實學校的規則包、開課資料抽出來之後，進系統之前要經過人工校對。這個資料夾放校對要用的東西。

| 檔案 | 內容 |
|---|---|
| [fju-im-111.md](fju-im-111.md) | 輔大資管 111 規則包的**校對清單與回覆紀錄**：哪些地方需要人判斷、回覆了什麼、草稿怎麼改 |
| [fju-im-111.draft.json](fju-im-111.draft.json) | 規則包草稿（v0.3）。`npx tsx scripts/push-draft.ts` 上傳後在 `/review/fju-im-111` 逐項校對 |
| [fju-offerings-115-2.json](fju-offerings-115-2.json) | 輔大資管 115-2 系上課表的抽取結果與問題清單（`scripts/fju-timetable.py` 產生） |

**誰在校對**：mintguesss（111 學年入學，草稿以本人的修業情況為準）。校對進行中，改草稿前先講。

**校對頁上直接改**：按「需要修正」會打開表單，改完存檔就是新版草稿（自動驗證、留修改紀錄）。
線上改過之後，repo 裡的 `.draft.json` 會比資料庫舊 —— 要同步時從資料庫匯出，別用舊檔覆蓋線上版本。

**維護者改檔的流程**（表單改不了的情況）：改 `.draft.json` → `npx tsx scripts/validate-rulepack.ts <檔案>` → `npx tsx scripts/push-draft.ts <檔案>`
→ 在 `/review/<id>` 校對（只有改到的項目要重看）→ 全部通過後鎖版，發布到 Supabase `rule_packs`。

原始 PDF 不進 repo（`.data/sources/`，已 gitignore），文件網址記在草稿的 `documents[].url`。
學生的成績單一樣只放 `.data/`，**只取課名，成績與個資不進 repo**。
