# Aidit — 實作規格書

修業規劃與畢業審查輔助系統（AI + audit，degree audit 的諧音）。本文件為交付給實作端的唯一規格來源，UI 參考 [design/aidit-demo-v5.html](design/aidit-demo-v5.html)。

---

## 0. 專案範圍

### 要做的

1. 讀取學生修課紀錄，判定適用的課程規劃表版本
2. 逐類別比對畢業學分，產出可溯源的審查結果
3. 偵測規則衝突，主動檢索補充依據；解不掉的明確轉人工
4. 依未修學分 + 開課資料 + 限制條件，求解下學期選課組合
5. 情境試算：改變條件後重新推算（提前畢業、輔系、學程、停修影響、成績門檻）
6. 完整執行紀錄（trace），可供查核

### 不做的（寫死在設計裡，不要「順便加上去」）

- 不代為選課、不寫回任何校務系統
- 不儲存學生帳密、不代為登入
- 不預測成績、不預測是否被當
- 不對教師產生評價性結論
- 不對第三方論壇做大量爬取

### 規模控制

第一版只支援 **1 個學系 × 1 個入學學年**（資管系 111 學年度）。規則以設定檔描述，新增系所只需新增規則包，不得改動程式邏輯。

---

## 1. 技術選型

| 項目 | 選擇 | 理由 |
|---|---|---|
| 框架 | Next.js 15（App Router）+ TypeScript | 前後端同一套，部署簡單 |
| 樣式 | Tailwind CSS + 自訂 design token | demo 的 CSS 變數直接轉為 token |
| 資料庫 | Supabase（Postgres） | 開課資料、規則包、trace 儲存 |
| LLM | Anthropic API（規則抽取、衝突解消、試算意圖解析） | — |
| 求解 | 自寫 backtracking（課程數量級 < 100，不需要 CP-SAT） | 避免引入 Python 依賴 |
| 測試 | Vitest | golden set 跑回歸 |

**不要引入 agent 框架**（LangChain / LangGraph 等）。流程是有限且已知的，用一個 step runner 就夠，而且 trace 要能自己控制格式。

---

## 2. 目錄結構

```
src/
  app/
    page.tsx                    審查結果頁（主畫面）
    api/
      audit/route.ts            POST 執行審查
      plan/route.ts             POST 選課求解
      whatif/route.ts           POST 情境試算
      trace/[id]/route.ts       GET 取回 trace
  lib/
    providers/
      types.ts                  CourseRecordProvider 介面
      mock.ts                   合成資料（Demo 與測試用）
      upload.ts                 學生自行匯出檔解析
      session.ts                瀏覽器 session 讀取（後續）
    rules/
      schema.ts                 規則包型別
      loader.ts                 載入與版本判定
      packs/im-111.json         資管系 111 學年度規則包
    agent/
      runner.ts                 step runner + trace 收集
      steps/                    每個步驟一個檔
      tools/                    工具實作
    audit/
      engine.ts                 確定性學分比對（無 LLM）
    solver/
      schedule.ts               選課組合求解
  components/                   UI 元件
  eval/
    golden/                     golden set（合成學籍 + 標準答案）
    run.ts                      評測執行器
```

---

## 3. 資料模型

```ts
// ---- 學籍與修課 ----
type Student = {
  id: string;                    // 去識別後的代號，非學號
  dept: string;                  // "IM"
  admissionYear: number;         // 學籍入學學年，如 111
  actualAdmissionYear: number;   // 實際入學學年（轉系/轉學時不同）
  status: "enrolled" | "leave" | "graduated";
  program: "day" | "night";
  minors?: string[];             // 輔系
  doubleMajors?: string[];
  certPrograms?: string[];       // 學分學程
};

type CourseRecord = {
  code: string;                  // 課號
  name: string;
  credits: number;
  year: number;                  // 學年度
  term: 1 | 2 | "summer";
  selectType: "required" | "elective" | "general";  // 選別
  generalDomain?: string;        // 通識領域
  score: number | null;          // null = 尚未登錄
  status: "passed" | "failed" | "in_progress" | "withdrawn" | "waived";
  waiverSource?: string;         // 抵免來源說明
};

type StudentRecord = {
  student: Student;
  courses: CourseRecord[];
  fetchedAt: string;             // ISO
  source: "mock" | "upload" | "session" | "api";
};

// ---- 開課 ----
type Offering = {
  code: string;
  name: string;
  credits: number;
  year: number;
  term: 1 | 2 | "summer";
  teacher: string;
  slots: TimeSlot[];             // 上課時段
  dept: string;                  // 開課單位
  college: string;
  category: string[];            // 可採計之類別 id
  generalDomain?: string;
  prerequisites: string[];       // 先修課號
  capacity: number;
  enrolled: number;
  syllabusUrl?: string;
};

type TimeSlot = { day: 1|2|3|4|5|6|7; periods: number[] };  // periods: [3,4]

// ---- 審查結果 ----
type Citation = {
  docId: string;                 // 規則包中的文件 id
  docTitle: string;
  locator: string;               // "第 4 頁附註 3"
  quote?: string;                // 原文片段，用於 citation.verify 比對
  url?: string;
  publishedAt?: string;
};

type CategoryResult = {
  id: string;
  name: string;
  required: number;
  earned: number;                // 已修得且可採計
  inProgress: number;
  unmet: number;                 // 未修
  overflow: number;              // 超修（不可流用）
  status: "satisfied" | "unmet" | "pending_in_progress";
  subRules: SubRuleResult[];     // 如通識四大領域分布
  citations: Citation[];
  notes: string[];
};

type HoldItem = {
  id: string;
  title: string;
  body: string;                  // 已檢索過哪些來源、為何仍無法判定
  conflictOf?: [Citation, Citation];
  impact: string;                // "採計後系專業選修未修 3 → 0"
  contact: string;               // 建議洽詢單位
  affectedCategory?: string;
};

type AuditResult = {
  traceId: string;
  rulePack: { id: string; version: string; approvedAt: string };
  minCredits: number;
  totalEarned: number;           // 含超修
  countable: number;             // 可採計
  inProgress: number;
  unmet: number;
  overflow: number;
  categories: CategoryResult[];
  graduationChecks: GraduationCheck[];   // 中文/英文/資訊能力、服務學習
  holds: HoldItem[];
  verdict: { headline: string; detail: string; level: "ok"|"unmet"|"blocked" };
};
```

### 關鍵不變式（寫成測試）

```
countable + inProgress + unmet === minCredits
totalEarned === countable + overflow
```

超修不得填補任何類別的 unmet。這是 UI 上「132 學分卻還不能畢業」的來源，必須在引擎層保證。

---

## 4. Provider 介面

三種資料來源實作同一個介面。上層不得知道自己拿到的是哪一種。

```ts
interface CourseRecordProvider {
  readonly kind: "mock" | "upload" | "session" | "api";
  fetch(input?: unknown): Promise<StudentRecord>;
  capabilities(): {
    hasWaivers: boolean;         // 是否含抵免資料
    hasEnrollment: boolean;      // 是否含目前修課中
    hasCertPrograms: boolean;
  };
}
```

實作順序：

1. **`mock.ts`** — 先做，Demo 與評測都靠它。必須涵蓋難例（見 §10）
2. **`upload.ts`** — 學生自行從校務系統匯出的 CSV / HTML，解析成 `StudentRecord`
3. **`session.ts`** — 後續；憑證不離開使用者瀏覽器

`capabilities()` 缺哪一項，對應的判定就進 holds，不得猜測。

---

## 5. 規則包

規則包是 JSON，由 LLM 從課程規劃表抽取後**人工校對**，不是執行期即時解析。

```jsonc
{
  "id": "im-111",
  "dept": "IM",
  "admissionYear": 111,
  "program": "day",
  "version": "1.2",
  "approvedAt": "2023-06-14",
  "minCredits": 128,
  "documents": [
    { "id": "plan-im-111", "title": "111 學年度資訊管理學系課程規劃表",
      "url": "...", "publishedAt": "2023-06-14" },
    { "id": "regulation", "title": "學則", "url": "..." }
  ],
  "categories": [
    {
      "id": "common-required",
      "name": "校訂共同必修",
      "credits": 20,
      "match": { "type": "courseList", "codes": ["GC1001", "..."] },
      "citation": { "docId": "plan-im-111", "locator": "第 2 頁" }
    },
    {
      "id": "general",
      "name": "通識涵養課程",
      "credits": 12,
      "match": { "type": "selectType", "value": "general" },
      "subRules": [
        { "id": "domain-coverage", "type": "domainCoverage",
          "domains": ["人文藝術", "社會科學", "自然科技", "生命探索"],
          "minPerDomain": 1,
          "citation": { "docId": "plan-im-111", "locator": "第 3 頁" } }
      ],
      "citation": { "docId": "plan-im-111", "locator": "第 3 頁" }
    },
    {
      "id": "major-elective",
      "name": "系專業選修",
      "credits": 24,
      "match": { "type": "deptElective", "dept": "IM" },
      "ambiguities": [
        { "id": "cross-college",
          "description": "附註 3 允許跨院選修採計，未列明得採計之開課單位範圍",
          "trigger": { "type": "courseFromOtherCollege" },
          "citation": { "docId": "plan-im-111", "locator": "第 4 頁附註 3" },
          "contact": "系辦公室課務承辦人" }
      ]
    }
  ],
  "overflowPolicy": {
    "free-elective": { "countsToTotal": true, "transferable": false,
      "citation": { "docId": "regulation", "locator": "第 24 條" } }
  },
  "graduationChecks": [
    { "id": "english", "name": "英文能力檢定", "rule": "deptDefined",
      "citation": { "docId": "plan-im-111", "locator": "第 1 頁" } }
  ],
  "termLimits": { "maxCredits": 25, "minCredits": 9 }
}
```

**`ambiguities` 是核心設計。** 規則包明確記錄「這條規則有洞」。命中 trigger 時，該筆修課不計入，並產生一個 HoldItem。這讓「不確定」是資料驅動的，不是 LLM 臨時判斷。

---

## 6. Agent 流程

### 步驟定義

```ts
type StepResult<T> = {
  status: "ok" | "partial" | "retried" | "held" | "failed";
  data?: T;
  summary: string;               // 顯示在 trace 的那一行
  retries: number;
  ms: number;
  toolCalls: ToolCall[];
};
```

| # | step | 工具 | 說明 | 失敗處理 |
|---|---|---|---|---|
| 1 | `fetchRecord` | `record.fetch` | 取得 StudentRecord | 失敗中止，回錯誤頁 |
| 2 | `resolveRuleVersion` | `rule.resolve` | 以 `admissionYear` 綁定規則包 | `admissionYear !== actualAdmissionYear` → 全案轉人工 |
| 3 | `detectConflicts` | `rule.conflict` | 比對規則包與公告庫，找出版本／適用對象衝突 | — |
| 4 | `reconcileConflicts` | `rule.reconcile` | **LLM**：檢索公告，判斷是否適用本學籍 | 解不掉 → HoldItem |
| 5 | `auditCredits` | `credit.audit` | **確定性程式，不經 LLM** | 不變式檢查失敗 → 中止並報錯 |
| 6 | `verifyCitations` | `citation.verify` | 每條結論的 quote 回查原文 | 對不上 → 重試 1 次 → 仍失敗則轉 HoldItem |
| 7 | `searchOfferings` | `course.search` | 查下學期開課 | 查無 → 略過 8、9 |
| 8 | `solveSchedule` | `schedule.solve` | 求解選課組合 | 無解 → 回報衝突原因，放寬條件重試 1 次 |
| 9 | `retrieveDiscussions` | `web.retrieve` | 課程公開討論（非阻塞） | 逾時 3s 即放棄，標記 partial |
| 10 | `scanExternal` | `safety.scan` | 外部內容注入檢查 | 命中 → 丟棄該筆並記錄 |

### 硬性規則

- **第 5 步不得呼叫 LLM。** 學分加總是確定性運算，這是不幻覺的保證。
- **第 9 步必須非阻塞。** 先回審查結果，討論資料後到。
- **每一步都要寫 trace**，包含失敗與重試。trace 是決賽的交付項目。

### 狀態機

```
fetchRecord ──fail──> ERROR
     │ok
resolveRuleVersion ──mismatch──> ALL_HOLD（整案轉人工）
     │ok
detectConflicts → reconcileConflicts
     ├─resolved─→ auditCredits
     └─unresolved─→ 產生 HoldItem → auditCredits（該項不計入）
                          │
                    verifyCitations ──fail×2──> 該條轉 HoldItem
                          │ok
                    searchOfferings ──empty──> DONE（僅出審查結果）
                          │
                    solveSchedule ──no solution──> 放寬條件重試 → 仍無解則回報衝突
                          │
                    retrieveDiscussions（非阻塞）→ scanExternal → DONE
```

---

## 7. 工具規格

```ts
// 每個工具都回傳統一形狀，方便 trace 收集
type ToolCall = {
  name: string;
  input: unknown;
  output: unknown;
  ms: number;
  status: "ok" | "partial" | "failed";
  error?: string;
};
```

| 工具 | 輸入 | 輸出 | 備註 |
|---|---|---|---|
| `record.fetch` | provider kind | StudentRecord | 走 Provider 介面 |
| `rule.resolve` | Student | RulePack | 純查表 |
| `rule.conflict` | RulePack, 公告庫 | Conflict[] | 比對適用對象欄位 |
| `rule.reconcile` | Conflict | `{resolved, citation, reason}` | **LLM**，須回傳引用 |
| `credit.audit` | StudentRecord, RulePack | CategoryResult[] | **純程式** |
| `citation.verify` | Citation[] | `{verified[], failed[]}` | 字串比對原文 |
| `course.search` | 類別, 學期 | Offering[] | 查自建開課資料庫 |
| `schedule.solve` | 未修, Offering[], 限制 | Plan[] \| Conflict | backtracking |
| `web.retrieve` | 課名, 教師 | Discussion[] | 搜尋 API，不自寫爬蟲 |
| `safety.scan` | 任意外部文字 | `{safe, blocked[]}` | 見 §9 |

---

## 8. API

```
POST /api/audit
  body: { providerKind: "mock"|"upload", payload?: unknown }
  res:  AuditResult

POST /api/plan
  body: { traceId: string, preset: "fill-unmet"|"no-early"|"fewest-courses",
          constraints?: { avoidDays?: number[], maxCredits?: number } }
  res:  { plans: Plan[], excluded: ExclusionSummary, conflicts?: Conflict[] }

POST /api/whatif
  body: { traceId: string, scenario: string }
  res:  WhatIfResult

GET  /api/trace/:id
  res:  { steps: StepResult[], toolCalls: ToolCall[], blockedContent: [] }
```

---

## 9. 安全與治理

### 外部內容

網路討論一律視為**不可信輸入**：

1. 包成資料區塊（`<external_content>`），永不進入指令通道
2. `safety.scan` 檢查指令樣式（「忽略先前」「system:」「你現在是」等），命中即丟棄並記入 trace
3. 不參與任何學分或採計判定，僅作為呈現資訊
4. 每則附來源網址與發文時間，標示為匿名討論
5. 不產生教師層級的評分或評價結論
6. 使用搜尋 API 取得公開結果後讀取單頁，**不對論壇做大量擷取**

### 個資

- 修課紀錄僅於單次 request 生命週期處理，不落地
- trace 儲存**去識別後**內容，不得含姓名、學號
- Demo 與評測一律使用合成資料
- 所有文件與程式碼不得含金鑰、真實個資

### 權限

- 系統無任何寫入校務系統的能力（架構上就沒有這種 endpoint）
- 高風險判定（畢業資格）一律標示為參考，非證明

---

## 10. 評測（決賽交付項目，務必留時間）

### Golden set

`eval/golden/` 放 30–50 份合成 StudentRecord + 人工算好的標準答案。必須涵蓋：

| 難例 | 測什麼 |
|---|---|
| 一般生 | 基準正確性 |
| 超修自由選修但類別未達 | 不變式、不得流用 |
| 轉系生（兩個入學學年不同） | 是否正確轉人工而非硬算 |
| 有抵免且抵免課號已停開 | HoldItem 產生 |
| 修過舊課號 | 對照處理 |
| 雙主修 | 類別歸屬 |
| 重補修同一門 | 不得重複採計 |
| 跨院選修 | ambiguity trigger |
| 通識領域分布未達但學分已足 | subRule 判定 |

### 基準方案

1. **人工**：請同學對照規劃表自行計算，記錄耗時與錯誤率
2. **單次 LLM**：所有規章塞進 context 問一次
3. **固定 workflow**：無狀態、不檢索補充依據

### 必須報的指標（對應競賽附件二）

正確率、成功率、平均與最大延遲、每次成本、工具調用成功率、重試次數、人工介入率、中止率、錯誤分類、提示注入測試結果。

### 核心論述

**在畢業審查場域，答錯的代價遠高於不答。** 系統優化目標是**零錯答**，可接受較高的轉人工率。評測報告要用數據支撐這個取捨。

### 注入測試

自寫 10–20 則含惡意指令的假貼文，混入檢索結果，測攔截率。這是「安全、治理與倫理」項目的關鍵證據。

---

## 11. 前端

### 頁面

單頁 `/`，區塊順序固定：

1. 頂條（系統名、學年期、系所）
2. 左欄：學籍卡（含**適用規劃表版本**，這是亮點，要顯眼）、畢業條件檢核
3. 主區：標題 + 判定結論句 → 修業尺 → 五格數字 → 分頁 → 情境試算
4. 頁尾免責聲明

### 元件

| 元件 | 說明 |
|---|---|
| `VerdictBanner` | 判定結論句。三種 level 對應三種色帶 |
| `ProgressRuler` | 單一橫條，三段填色，下方 0/32/64/96/128 刻度。超修以文字說明，不畫進條內 |
| `FigureRow` | 五格數字。用 `gap:1px + background:line` 做框線，欄數變動不破版 |
| `CategoryTable` | 分類明細。`<720px` 時整列轉 grid 區塊 |
| `HoldList` | 待確認事項 |
| `PlanTable` | 選課建議 |
| `TraceTable` | 執行紀錄 |
| `ScenarioPanel` | 情境試算 |
| `CitationToggle` | 依據展開／收合 |

### Design token

直接沿用 demo 的 CSS 變數（`--ink`、`--unmet`、`--hold` 等），搬進 Tailwind config。

**視覺原則**：這是校務系統的一部分，不是 AI 產品。不用圓角卡片、漸層、emoji、聊天泡泡。等寬字只用於課號、工具名、數值對齊。

### RWD

- `≥940px`：左欄 + 主區兩欄
- `<940px`：單欄堆疊
- `<720px`：表格轉 grid 區塊；執行紀錄只留步驟與結果
- `<560px`：數字列兩欄

---

## 12. 情境試算

不是聊天機器人。是**帶著現有審查結果重新求解**。

### 流程

1. 使用者輸入自然語言或點選建議 chip
2. **LLM 只做意圖解析**，輸出結構化 scenario：

```ts
type Scenario =
  | { type: "early-graduation"; targetTerm: string }
  | { type: "add-minor"; dept: string }
  | { type: "add-cert-program"; program: string }
  | { type: "withdraw-course"; code: string }
  | { type: "grade-threshold"; target: string };
```

3. 依 type 呼叫對應的**確定性推算**（重跑 audit / solve，改變輸入條件）
4. 輸出同樣附依據，且明確標示「未計入 N 項待確認事項」

### 輸出格式

```ts
type WhatIfResult = {
  headline: string;              // "目前條件下不可行"
  level: "feasible" | "infeasible" | "conditional";
  detail: string;                // 為什麼，哪些課、哪些衝突
  alternatives: string[];        // 替代路徑
  citations: Citation[];
  uncountedHolds: number;
};
```

**無解時要說明「哪兩個條件在打架」**，不是只回一句做不到。這是 Agent 與固定流程的差別，也是 demo 影片裡最有說服力的一段。

### 意圖解析不明時

回問一個澄清問題，不要猜。無法對應到任何 scenario type 時，明確回覆「此類問題請洽系辦」，不自由發揮。

---

## 13. 開發順序

| 週 | 目標 | 產出 |
|---|---|---|
| 1 | 規則包 + 確定性引擎 | `im-111.json`、`audit/engine.ts`、不變式測試通過 |
| 1 | 開課資料爬取（公開頁面） | Supabase 中有 115-1 全校開課 |
| 2 | Provider（mock + upload）、golden set | 30 份合成資料 + 標準答案 |
| 2 | Agent runner + trace | 前 6 步跑通 |
| 3 | 求解器 + 選課建議 | 3 組方案、無解回報 |
| 3 | 前端接上真實資料 | demo 版面接 API |
| 3 | 情境試算 | 至少 3 種 scenario |
| 4 | 評測 + 注入測試 | 三組基準比較、指標表、trace 匯出 |
| 4 | 影片 + 簡報 | 留兩天緩衝 |

### 兩人分工

- **A**：規則包、確定性引擎、求解器、golden set
- **B**：Agent runner、工具、前端、評測執行器

---

## 14. 簡報注意事項

- 初賽採**匿名審查**。簡報、影片、檔名不得出現校名、系名、指導教師
- 所有截圖需去識別：學號打碼、校徽移除、課號前綴改為通用代碼
- Agent 狀態圖要畫出**分支與重試**，不要畫成單向箭頭流程圖，否則會被判為固定流程

---

## 15. 給實作端的提醒

1. 先寫 `§3 不變式`的測試，再寫引擎
2. `credit.audit` 任何時候都不准出現 LLM 呼叫
3. 每個 HoldItem 都必須說明「已檢索過哪些來源」，否則看起來像偷懶
4. trace 的每一行都會被評審看到，summary 要寫得像工程日誌，不是行銷文案
5. 遇到取捨時，選「寧可不答」的那一邊
