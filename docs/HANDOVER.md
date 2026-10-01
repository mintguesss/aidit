# 後端交接

寫給接手後端的人與其 AI 助理。這份很短，講的是**你的任務**；
規則、CI、模組邊界、不要做的事一律在 [CONTRIBUTING.md](../CONTRIBUTING.md)，
開工前整份讀完，那是必要的。

---

## 專案是什麼

Aidit：畢業學分審查與修業規劃系統。核心主張是**在畢業審查場域，答錯的代價
遠高於不答** —— 優化目標為零錯答，接受較高的轉人工率。

技術上這句話是這樣落實的：判定層（學分歸屬、排課求解、引用回查）**不含任何
模型**，是確定性程式；模型只負責把自然語言轉成結構化參數，以及把結構化結果
組成人話。這件事由 CI 沿 import 圖機械檢查 —— 見 CONTRIBUTING.md 第 2 節，
那是整個專案的支柱。

## 目前狀態（2026-10-01）

前端完成並上線（https://aidit-weld.vercel.app/），判定引擎、求解器、引用回查、評測與注入測試都在跑，
單元測試與七項 CI 全綠。儲存層已經接上 Supabase：執行紀錄、偏好（含額外修業目標）、
規則包與語料、校對紀錄、草稿、上傳的原始 PDF 都落地了，migration 在
`supabase/migrations/`。資料盤點見 [DATA.md](DATA.md)。

**系統裡並存兩所「學校」**，以 `school` 欄位區分（[lib/schools.ts](../src/lib/schools.ts)）：

| | `demo`（合成） | `fju`（輔仁大學資訊管理學系） |
|---|---|---|
| 用途 | golden set 與 CI 的回歸基準，**不要改** | 第一所真實學校 |
| 規則包 | `src/lib/rules/packs/im-111.json` | 草稿 v0.3，**人工校對中**（見下） |
| 原文語料 | `src/lib/rules/corpus/` | 同一資料夾的 `fju-*.txt` |
| 開課資料 | `src/lib/offerings/raw.ts` | `src/lib/offerings/data/fju-115-2.json`（34 班） |
| 學生修課紀錄 | 合成夾具 | **還沒有**（H3 等鎖版） |

課號格式、節次表依學校而異，集中在 [lib/courses/code.ts](../src/lib/courses/code.ts) 與
[lib/offerings/period-scheme.ts](../src/lib/offerings/period-scheme.ts)。新學校進來時改這兩處，
不要在別的檔案寫死正規式或節次。

對話層接過本機模型（qwen3:14b）實測，端到端測試在 `npm run chat:e2e`。
那一側學到的事在 [SELFHOST.md](SELFHOST.md) §六：真實模型的錯法是
**形狀合法、內容是編的**，schema 驗證擋不住，要靠程式比對原句。

## 正在進行，先不要動

- **輔大規則包草稿 `fju-im-111`**：維護者正在
  [/review/fju-im-111](https://aidit-weld.vercel.app/review/fju-im-111) 逐項校對。
  草稿檔在 [review/fju-im-111.draft.json](review/fju-im-111.draft.json)，校對清單與回覆紀錄在
  [review/fju-im-111.md](review/fju-im-111.md)。改草稿會讓改到的項目必須重新校對 —— **要改先講**。
- **H3 輔大示範學生**：等上面鎖版後做，會以 示範成績單（只取課名，
  不含成績與個資）為參考。原始成績單只留在本機，不進 repo。

## 可以接的工作

分工還沒正式定，**開工前先跟 維護者 確認你拿哪幾項**。依 [TODO.md](TODO.md)，不會跟上面撞到的有：

- **E1–E4 資安**：目前完全沒有身分驗證，`/api/preferences` 任何人都能讀寫刪指定學生的偏好（E3）。
  `providers/` 接校務資料（C4）**必須等這幾項做完**
- **C3 輔大開課資料**：系上課表已抽完；教務處系統的部分（通識、國文、外文、體育、餘額）
  要等課務組回信再決定怎麼拿
- **C5 學期行事曆**：輔大學期起訖還是合成的，課表匯出直接吃這張表
- **H7、H8**：「不排早上」包含特早節 D0、單雙週上課
- **B7**：校對頁看「使用者上傳」的原始 PDF（公開文件的連結已經有了）

## 動工前要先談的一件事

`fixture` 這個查詢參數現在同時扮演「選哪份測試案例」和「選哪個學生」。
接上真實資料源後這兩件事會分家，而它牽動 [docs/API.md](API.md) 裡
大部分端點。**先跟前端談定再動。**

## 開場

```bash
npm install
npm run dev     # 不需要任何金鑰
npm run ci      # 七項全過才算基準正常
```

然後讀 CONTRIBUTING.md，特別是第 2 節（模組邊界）和第 6 節（不要做的事）。
第 6 節那四項都是看起來合理、但會拆掉支柱的做法。
