# Aidit

修業規劃與畢業審查輔助系統。

**本系統的核心主張：在畢業審查場域，答錯的代價遠高於不答。**
優化目標是零錯答，接受較高的轉人工率。

## 文件索引

| 你想做什麼 | 讀哪份 |
|---|---|
| 了解系統怎麼運作 | 本檔 §架構（往下捲） |
| 參與開發 | [CONTRIBUTING.md](CONTRIBUTING.md) —— 規則、CI、不要做的事 |
| 接手後端 | [docs/HANDOVER.md](docs/HANDOVER.md)，再讀上一列 |
| 串接 API | [docs/API.md](docs/API.md) —— 前後端分界線 |
| 部署公開 demo | [docs/DEPLOY.md](docs/DEPLOY.md) —— Vercel |
| 自架跑本機模型 | [docs/SELFHOST.md](docs/SELFHOST.md) —— Ollama、Tailscale |
| 知道有哪些資料、放在哪 | [docs/DATA.md](docs/DATA.md) |
| 看還有什麼沒做 | [docs/TODO.md](docs/TODO.md) |

規格文件（改動前先讀）：

| 文件 | 內容 |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | 系統規格。§9 是隱私邊界，解釋了為什麼很多東西刻意不存伺服器 |
| [docs/BACKEND.md](docs/BACKEND.md) | 後端實作細節。**§1 學分歸屬是全專案最容易算錯的地方** |
| [docs/CONVERSATION.md](docs/CONVERSATION.md) | 兩個對話介面的規則 |
| [docs/SPEC-CHANGES.md](docs/SPEC-CHANGES.md) | 所有與規格不一致之處，逐項記錄原因 |

---

## 快速開始

```bash
npm install
npm run dev          # http://localhost:3000
```

**不需要任何金鑰。** 沒有 `ANTHROPIC_API_KEY` 與 Supabase 設定時，
規則解消與意圖解析會使用確定性替身，trace 會標示 `mode=offline`，
Demo、評測、注入測試與 CI 都跑得完整。要接真實服務時複製 `.env.example` 為 `.env`。

### 其他指令

```bash
npm run test         # 307 項單元測試
npm run eval         # 評測報告（35 個 golden 案例 + 基準比較）
npm run eval:injection   # 提示注入攔截率／誤攔率
npm run ci           # docs/BACKEND.md §10 的 7 項 CI 檢查
npm run ui:check     # 版面檢查：13 頁 × 5 種寬度，不得出現橫向捲動（需 dev 已啟動）
npm run shots        # 產生 docs/screenshots/ 全系統截圖與 SPEC-CHANGES 快照（需 dev 已啟動）
npm run build
```

### 頁面

功能各自有網址，不是同一頁裡的 tab —— 承辦人要能把某一頁的連結直接貼給學生。
每個網址都帶 `?fixture=&term=`，評測難例可以逐案分享與重現。

| 路徑 | 內容 |
|---|---|
| `/` | 首頁：判定結論、修業進度尺、五格數字、「接下來」該做什麼 |
| `/audit` | 修業明細：逐類別學分比對，每一列可展開看採計了哪些課與引用原文 |
| `/holds` | 待確認事項：系統停止自動推論的地方，可一鍵寄信給承辦窗口 |
| `/plan` | 選課建議：週課表格線＋清單，課表微調對話（docs/CONVERSATION.md A 介面） |
| `/syllabus/<code>` | 課綱：系統手上的開課欄位、先修條件來源信心、原始檔下載 |
| `/assistant` | 修業問答：問題先分類再交給對應能力（docs/CONVERSATION.md B 介面） |
| `/scenario` | 情境試算：七個情境分四組，標明哪些可推算、哪些要先收錄規定 |
| `/profile` | 個人資料（唯讀）、選課傾向與額外修業目標（可編輯） |
| `/rulepack` | 適用規劃表：目前套用哪一版，以及上傳自己的那一版 |
| `/trace` | 執行紀錄：10 個步驟、工具調用、攔截內容 |
| `/review` | 規則包人工校對（內部作業頁） |
| `/sources` | 原文出處：所有被引用的條文，各頁的「依據」連結會跳到對應段落 |
| `/about` | 資料來源與免責聲明 |
| `/privacy` | 資料與隱私：偏好與執行紀錄的查閱、只刪選填、全部刪除、匯出 |
| `/api/trace/<id>` | 完整執行紀錄，可直接匯出查核 |
| `/api/offering/<code>` | 該門課的原始開課資料（抓取當下的未正規化列） |
| `/api/corpus/<docId>` | 被引用文件的原文全文；`citation.verify` 回查的就是這一份 |
| `/api/preferences` | 偏好的讀寫與刪除（以 studentHash 為鍵） |

**全站只有一條橫幅**：深色頂條裡同時放品牌、五個功能的主導覽
（總覽 → 修業明細 → 待確認 → 選課建議 → 修業問答）、學期與
`個人資料` / `執行紀錄` 兩個次要入口。

學籍資訊不在每一頁重複：頂條右側只放**姓名**（點下去就是個人資料頁），
學號、系級、學制、適用規劃表版本都在 `/profile`；判定依據的版本以一句稽核說明放在頁尾。
頁面標題就是標題，不是一張卡片 —— 內容區的第一個元素就是這一頁的標題。

頂端的「檢視案例」可切換 11 個評測難例（轉系生、超修不流用、跨院選修、
抵免停開課號、通識領域未達…）。每一個難例在 UI 上都看得到對應的行為，
而不只是測試報告裡的一行。

### 窄螢幕

手機版不是把桌機版縮小，而是把次要脈絡收起來：導覽改為側邊抽屜（一次看得完五個功能，
並收進四個次要入口）；冗長的規則說明改為可收合；表格整列轉成區塊；
週課表在自己的橫捲容器裡捲動，頁面本身不橫捲。
`npm run ui:check` 會在 360／390／720／940／1280 五個寬度機械驗證版面不破。

---

## 這個系統怎麼保證不亂算

### 1. 算數的那層沒有模型

`credit.audit`、`schedule.solve`、`citation.verify` 三個模組是純確定性運算。
CI 第 4 項會從這三個模組出發做**遞移**相依分析，只要任一層 import 到 LLM client 就 fail build。

```bash
npx tsx scripts/ci.ts   # [4] 模組邊界 … 通過
```

這條是整個專案最重要的一條：它用機械方式保證了「算數的那層沒有模型」這個技術主張。

### 2. 不變式失敗就中止，不輸出結果

```
countable + inProgress + unmet === minCredits
totalEarned === countable + overflow
```

超修不得填補任何類別的未修學分。這是 UI 上「123 學分卻還不能畢業」的來源，
在引擎層以 `InvariantError` 保證，不是靠前端的說明文字。

### 3. 每一條結論都要能回查原文

規則包的每個欄位都帶 `citation.quote`。輸出前 `citation.verify` 會把每一條引用
拿回原文比對（精確 → 模糊 ≥ 0.90），對不上就重試一次，仍失敗則**該條結論降級為待確認事項**。
模糊比對會在 trace 上標明，不藏起來。

### 4. 對話介面的每一個字都不是模型寫的

`docs/CONVERSATION.md` §0.1：LLM 只輸出**意圖與參數**。這不是提示詞的約定 ——
`src/lib/chat/intent.ts` 的 output schema 裡結構上就沒有 `answer` 或 `reply` 欄位，
模型即使想下判斷也沒有地方可以寫。回覆文字一律由 `compose.ts` 依 §3 的模板
從引擎輸出組出來，所以對話裡出現的每一個學分數字都等於審查引擎算的數字。

回答只有三種：**決定 / 不確定 / 超出範圍**，型別上沒有第四種。查不到依據就回「不確定」
並列出已查詢範圍與承辦窗口，不做相似度硬湊。成績預測、被當機率、教師評價、
代為選課、代為送件、違規繞過六項一律拒答。

### 5. 規則的洞是資料驅動的

規則包用 `ambiguities` 明確記錄「這條規則有洞」（例：附註 3 允許跨院採計但未列明範圍）。
命中 trigger 的修課**整個移出指派問題**，並產生一則待確認事項，
同時跑第二次指派算出「若被認定可採計，結果會如何」。

不確定是寫在規則包裡的，不是 LLM 臨時判斷的。

### 6. 外部內容永遠是資料，不是指令

網路討論一律包進 `<external_content>` 資料區塊，先過 `safety.scan`（9 種指令樣式），
命中即丟棄並記入 trace。目前語料：惡意 16 則攔截率 100%、正常 8 則誤攔率 0%。

即使某一則漏過樣式比對，它仍碰不到學分判定 —— 見上面第 1 條。

---

## 架構

```
src/
  app/
    page.tsx                    總覽
    audit/ holds/ plan/         修業明細、待確認、選課建議
    syllabus/[code]/            課綱
    about/                      資料來源與免責聲明
    rulepack/                   適用規劃表與上傳
    scenario/ trace/            情境試算、執行紀錄
    review/[packId]/            規則包人工校對
    assistant/ profile/          修業問答、個人資料
    api/{audit,plan,chat,whatif,trace,review,preferences,corpus,offering,rulepack,extra-goals}/
  components/                   依功能區塊分，不依型別分
    shell/                      外殼、導覽、案例切換、偏好生命週期
    audit/                      分類明細、修業進度、待確認、額外修業目標、情境試算
    plan/                       選課建議、週課表、生效條件
    chat/                       A／B 兩個對話介面
    sources/                    依據連結與原文出處的錨點定位
    settings/                   個人資料、資料與隱私、規劃表上傳
    trace/                      執行紀錄、規則包校對
  lib/
    types.ts                    型別的唯一定義來源
    providers/                  mock / upload / session
    rules/                      規則包 schema、loader、公告庫、原文語料
      inspect.ts                上傳規則包的結構檢查
      contacts.ts               承辦窗口通訊錄（查不到就不給寄信按鈕）
    audit/
      assign.ts                 學分歸屬（指派問題）
      engine.ts                 確定性學分比對
    solver/
      slots.ts                  時段字串解析
      schedule.ts               選課組合求解
    verify/citation.ts          引用回查
    safety/scan.ts              外部內容注入檢查
    chat/                       兩個對話介面（docs/CONVERSATION.md）
      types.ts                  三種回答類型、約束集合、上限
      intent.ts                 LLM 輸出（只有意圖與參數）
      apply.ts                  約束集合的建立與套用
      capabilities.ts           B 介面的四種能力
      compose.ts                唯一產生回覆文字的地方
      plan-turn.ts route.ts     每輪的求解、差異、代價與分派
    ui/prefs.ts                 選課傾向的瀏覽器端保存
    whatif/                     情境試算
    agent/
      runner.ts                 step runner + 狀態機
      steps/01..10              每個步驟一個檔
      tools/                    工具實作
    llm/client.ts               唯一的 LLM 呼叫入口
    store/                      trace 儲存（Supabase / 本地檔案）
  eval/
    golden/                     35 個案例（11 人工 + 24 程式生成）
    injection/                  提示注入語料與執行器
    run.ts                      評測執行器
scripts/
  pdf-to-segments.py            PDF → 分段文字（pdfplumber）
  extract-rulepack.ts           分段文字 → 規則包草稿
  validate-rulepack.ts          規則包自動驗證
  ci.ts                         CI 檢查
  ui-check.mjs                  版面檢查（以系統 Edge 驅動，不下載瀏覽器）
```

**沒有引入 agent 框架。** 流程是有限且已知的，一個 step runner 就夠，
而且 trace 的格式要能自己控制 —— trace 是交付項目。

### Agent 流程（含分支與重試）

```
fetchRecord ──fail──────────────────────────> ERROR（不輸出部分結果）
     │ok
resolveRuleVersion ──學籍/實際入學學年不符──> ALL_HOLD（整案轉人工）
     │ok                ──查無規則包／未校對──> ERROR
detectConflicts → reconcileConflicts
     ├─resolved───────> auditCredits
     └─unresolved─────> HoldItem ─> auditCredits（該項不計入）
                              │ 不變式失敗 ──> ERROR
                        verifyCitations ──fail×2──> 該條降級為 HoldItem
                              │ok
                        searchOfferings ──empty──> DONE（僅出審查結果）
                              │
                        solveSchedule ──無解──> 放寬 maxCredits → avoidDays
                              │                 → avoidEarly → 仍無解則回報衝突
                        retrieveDiscussions（3s 逾時即放棄，非阻塞）
                              │
                        scanExternal ──> DONE
```

---

## 選課建議：一份課表，不是選擇題

系統直接給**一份**最合適的課表，不並排三個方案讓學生選 —— 學生要的是答案，
而且他無從判斷三個方案差在哪。想比較就用下面的對話說「再給我一版」，系統會一併說明代價。

課表有兩種檢視：**週課表**（星期一到日 × 節次的格線，附起訖時間，已登記的實習／專題一併畫進去，
連續節次合併成一格，每格可點進課綱）與**清單**（學分、時段、教師、採計類別、餘額、衝堂檢核、課綱）。
每一門課都附 `/syllabus/<課號>`，呈現系統手上真的有的欄位 ——
時段、學分、教師、餘額、採計類別，以及先修條件是「結構化欄位」還是「由大綱文字抽取」。
後者只作提示，不據以排除課程：那是自然語言的判讀，錯了會害學生少修一門可以修的課。

---

## 選課建議：先依傾向，再談微調

學生在基本資料填寫選課傾向（修課目標、是否排早八、要空出的星期、期望堂數、學分上限、
是否希望課程集中），第一版課表直接依此求解；之後用一句話微調：

```
「不要早八」        → 重跑求解器，避開第 1 節
「少一堂課」        → 期望堂數 -1
「空出星期五」      → 星期五完全不排課（硬限制）
「課盡量集中」      → 偏好集中在少數幾天
「為什麼沒有演算法」→ 說明該門課被排除在第幾步、原因是什麼
「重來」            → 回到基本資料填寫的原始傾向
```

**對話的狀態是約束集合，不是訊息歷史**（`docs/CONVERSATION.md` §1.1）。
每輪把 `ConstraintDelta` 疊到 `ConstraintSet` 上再重跑求解，所以對話再長也不會漂移，
使用者也隨時看得到目前生效的條件清單。

每一輪一定回報三件事（§1.3）：**改了什麼／課表差異／代價**。
求得的方案無解時**不自動放寬**（§1.4）—— 可以放寬的方向以按鈕列出，由使用者決定。
docs/BACKEND.md §5 的自動放寬只留給第一版課表，因為那時還沒有人可以問。

硬限制與軟偏好的界線寫在 `docs/SPEC-CHANGES.md` §E1：
`avoidDays` 是硬限制；`avoidEarly` 是偏好，做不到時照排並明講「這個類別只有早八可選」。
**學則的學期學分下限（9）是硬規定不是偏好**：只要湊得到，交出的課表一律達標（§E12）。

---

## 規則包：從 PDF 到鎖版

```bash
# 1. PDF → 分段文字（保留頁碼與版面）
python scripts/pdf-to-segments.py plan.pdf plan-im-111 "111 學年度…課程規劃表" \
  > .data/segments/plan-im-111.json

# 2. LLM 結構化抽取 → 草稿（每個欄位都帶 quote）
npm run rulepack:extract -- --segments .data/segments/plan-im-111.json \
  --id im-111 --dept IM --year 111 --college MGT

# 3. 自動驗證（不通過就不進人工校對）
npm run rulepack:validate

# 4. 人工校對 → 鎖版
open http://localhost:3000/review/im-111
```

校對紀錄（誰、何時、通過或修正）留存於 `.data/reviews/`，作為資料品質的證據。
草稿重新抽取後 hash 會變，既有校對紀錄自動失效。

> 目前 `src/lib/rules/packs/im-111.json` 是 **合成規則包**（`provenance: "synthetic"`），
> 搭配合成的規劃表與學則原文語料，讓系統在沒有真實 PDF 的情況下能完整執行。
> UI 的學籍卡會明白標示「不得作為實際審查依據」。詳見 `docs/SPEC-CHANGES.md` §D1。

---

## 評測

```bash
npm run eval
```

目前結果（離線模式）：

| 指標 | 值 |
|---|---|
| 案例數 | 35（人工標準答案 11、程式生成 24） |
| 正確率 | 100% |
| **錯答率** | **0%** |
| 中止／轉人工率 | 2.9% |
| 工具調用成功率 | 100% |
| 注入攔截率／誤攔率 | 100% / 0% |

基準比較中，「固定 workflow」（貪婪指派、不處理規則缺口、一律作答）在 `demo` 與
`no-enrollment-data` 兩個案例上少報未修學分 —— 那正是會讓學生以為自己能畢業的那種錯。

標準答案的來源分兩種，兩種都不是從引擎反推：

- **11 份人工**：對照合成規劃表逐項手算，算式寫在 `src/eval/golden/cases.ts` 的 `workings` 欄位
- **24 份程式生成**：由 `generated.ts` 內一份**獨立參考實作**計算；
  生成器刻意把案例限制在「指派無歧義」的範圍，讓參考實作能保持四則運算的簡單度

---

## 安全與治理

- 不代為選課、不寫回任何校務系統（架構上沒有這種 endpoint，CI 會檢查）
- 不儲存學生帳密、不代為登入（`api` provider 直接拋錯）
- 不預測成績、不預測是否被當（情境試算的 `grade-threshold` 只回報已確定的數字）
- 不對教師產生評價性結論
- 不對第三方論壇做大量爬取（使用搜尋 API 取得公開結果後讀取單頁）
- 修課紀錄僅於單次 request 生命週期處理，不落地
- trace 僅存去識別後內容（學號經 HMAC，輸入輸出過 scrubber），保留 90 天
- 高風險判定（畢業資格）一律標示為參考，非證明

---

## 已知限制

- 第一版只支援 1 個學系 × 1 個入學學年（資管系 111 學年度）。
  新增系所只需新增規則包，不需改動程式邏輯。
- `session` provider 未啟用；`api` provider 不實作。
- 輔系／學分學程的情境試算會明確回報「尚未收錄該修習規定」，不作任何推算。
- 基準 A（人工計算）與基準 C（單次 LLM）尚未實測，評測報告標示為未執行，
  不填入未實測的數字。
