# Aidit — 後端實作補充

本文件補充 `SPEC.md` 未展開的後端細節。優先讀 §1，那是最容易算錯的地方。

---

## 1. 學分歸屬：這是指派問題

### 問題

一門課可能同時符合多個類別。最常見的情況：

| 課程 | 可能歸屬 |
|---|---|
| 外系選修 | 系專業選修（若跨院採計）／自由選修 |
| 本系選修超過 24 學分的部分 | 系專業選修／自由選修 |
| 通識課超過 12 學分的部分 | 通識／自由選修 |
| 學程課程 | 系專業選修／自由選修／學程 |

**貪婪指派會產生假的未修。** 例：學生修了 24 學分選修，系專選需 24、自由選修需 12。若先塞自由選修，系專選會顯示未修 12 —— 但換個分配就滿足了。這種錯誤會叫一個已能畢業的學生多讀一學期，是最不能犯的錯。

### 演算法

```
1. 分類每筆修課的候選類別集合 eligible(course) ⊆ categories
2. forced   = { c : |eligible(c)| == 1 }   直接指派
3. ambiguous = 其餘（實務上通常 < 10 門）
4. 對 ambiguous 做 backtracking，目標函數：
     minimize  Σ_category max(0, required - assigned)
   相同目標值時，用穩定決勝：
     a. 先滿足 required 較大的類別
     b. 課程依 (學年度, 學期, 課號) 升冪指派
5. 溢出：assigned > required 的部分記為 overflow，依 overflowPolicy 決定
   是否計入 totalEarned，但一律不得補其他類別的 unmet
```

`ambiguous` 若超過 16 門（理論上不會，但要防呆），改用 max-flow 鬆弛求上界，並在 trace 標記為近似解。

### 為什麼決勝規則很重要

「這門課被採計為系專業選修」本身是一條會出現在依據裡的結論。同一份資料跑兩次得到不同指派，整個可溯源的主張就垮了。**決勝規則必須寫成測試**。

### 待確認項的處理

命中 `ambiguities.trigger` 的課程（如跨院選修），從指派問題中**整個移除**，不參與最佳化。同時計算「若該課被認定可採計，結果會如何」，填入 HoldItem 的 `impact` 欄位 —— 那需要跑第二次指派。

```ts
type AssignmentResult = {
  assignments: Map<courseCode, categoryId>;
  overflow: Map<categoryId, number>;
  unmet: Map<categoryId, number>;
  alternativeIfHoldResolved?: AssignmentResult;  // 待確認項被採計後的結果
};
```

---

## 2. 規則包產生流程

**離線批次，不是執行期解析。** 這是整個系統的地基，第一週就要做完。

```
課程規劃表 PDF
   ↓ pdfplumber（保留頁碼與版面）
分段文字
   ↓ LLM 抽取（structured output, temperature 0）
RulePack 草稿（每個欄位都帶 citation.quote）
   ↓ 自動驗證
   ↓ 人工校對頁
鎖定版本 + content hash
```

### 自動驗證（不通過就不進人工校對）

```ts
assert(sum(categories.map(c => c.credits)) === minCredits);
for (const cite of allCitations) {
  assert(sourceText[cite.docId].includes(normalize(cite.quote)));
}
assert(allCourseCodes.every(c => /^[A-Z]{2}\d{4}$/.test(c)));
assert(new Set(categories.map(c => c.id)).size === categories.length);
```

`quote` 欄位是後續 `citation.verify` 的唯一依據。**抽取時沒留 quote 的欄位，後面就無法驗證**，等同於沒有依據。

### 人工校對頁

一個簡單的內部頁面：左邊原文（高亮 quote 位置），右邊抽取結果，逐條 approve / 修正。校對紀錄要留（誰、何時），決賽可作為資料品質的證據。

### 公告庫

`rule.conflict` 需要一個可比對的對象。建一張表：

```sql
announcements(
  id, title, url, published_at,
  applies_to_raw text,        -- 原文中描述適用對象的段落
  applies_to_years int[],     -- LLM 解析後，NULL 表示未載明
  scope text,                 -- 'general' | 'dept' | 'university'
  content text
)
```

`applies_to_years IS NULL` 就是衝突訊號 —— 公告沒說適用哪幾屆，這正是第三個待確認事項的來源。

---

## 3. citation.verify 實作

驗證的是**規則引用**，不是 LLM 的敘述。目的是抓出被幻覺出來的規則。

```ts
function verify(cite: Citation, corpus: Map<string, string>): VerifyResult {
  const src = corpus.get(cite.docId);
  if (!src) return { ok: false, reason: "document_missing" };

  const q = normalize(cite.quote);   // 去空白、全半形統一、去標點
  if (normalize(src).includes(q)) return { ok: true, method: "exact" };

  const best = fuzzyBestMatch(q, normalize(src));   // 滑動視窗 + Levenshtein
  if (best.ratio >= 0.90) return { ok: true, method: "fuzzy", ratio: best.ratio };

  return { ok: false, reason: "quote_not_found", bestRatio: best.ratio };
}
```

失敗處理：重試一次（重新抽取該欄位）→ 仍失敗 → 該條結論**降級為 HoldItem**，不得以未驗證的依據輸出。

`method: "fuzzy"` 要顯示在 trace 上，不要藏起來。

---

## 4. 開課資料正規化

**最容易低估工時的部分。** 排一整週，不要排三天。

### 時段字串解析

實際會遇到的格式差異很大：

```
"二 3-4,5"      → [{day:2, periods:[3,4,5]}]
"五 2-3-4"      → [{day:5, periods:[2,3,4]}]
"三 6-8"        → [{day:3, periods:[6,7,8]}]
"一 A,B"        → [{day:1, periods:[11,12]}]   夜間節次
"二 3-4 / 四 5" → 兩個 slot
"無上課時間"     → []
```

做法：先蒐集 500 筆真實字串當測試語料，寫 parser 跑到 100% 通過。**解析失敗的課程要標記而不是丟棄** —— 它仍可被採計，只是不能參與衝堂判定，UI 要標示「時段未知」。

節次本身已是離散整數，衝堂判定就是集合交集，不需要處理實際時間。

### 擋修（先修）資料

通常**不在課程查詢頁**，只出現在課程大綱的文字裡（「須先修過資料結構」）。

```ts
type Prerequisite = {
  codes: string[];
  confidence: "explicit" | "extracted" | "unknown";
  sourceText?: string;
};
```

- `explicit`：結構化欄位取得 → 當硬限制，求解器據此排除
- `extracted`：LLM 從大綱文字抽出 → **不當硬限制**，只在 UI 標示提醒
- `unknown`：查無 → 不處理

不要讓低信心的抽取結果去排除課程，那會造成無聲的錯誤建議。

### 抓取策略

| 資料 | 頻率 | 說明 |
|---|---|---|
| 課程基本資料、時段、類別 | 每學期選課前一次 + 每週一次 | 變動少 |
| 修課餘額 | 每日一次；選課期間每小時 | 變動快 |
| 課程大綱 | 隨基本資料 | 量大，分批 |

全部是公開頁面，加 `User-Agent` 標示、限速、遵守 robots.txt。抓取紀錄存 DB，決賽要能說明資料時效。

---

## 5. 求解器

```ts
function solve(unmet: Map<catId, number>, offerings: Offering[],
               constraints: Constraints, preset: Preset): SolveResult
```

### 流程

```
1. 候選過濾（每一步都記錄排除數量與原因）
   類別符合 → 先修已修畢(explicit) → 餘額>0 → 不與已排定時段衝突
2. 若任一 unmet 類別的候選集為空 → 立即回報 infeasible，附原因
3. backtracking：課程依學分降冪嘗試
   剪枝：剩餘候選可提供學分 < 尚缺學分 → 剪
   剪枝：已選學分 > maxCredits → 剪
4. 收集可行解，依 preset 排序取前 3 組
```

### preset 是不同的目標函數，不是不同演算法

```ts
const OBJECTIVES = {
  "fill-unmet":      s => [s.unmetAfter, s.courseCount],
  "no-early":        s => [s.earlyMorningCount, s.unmetAfter],
  "fewest-courses":  s => [s.courseCount, s.unmetAfter],
};
```

### 無解回報（UI 上「哪兩個條件在打架」的來源）

```ts
type Infeasibility = {
  category: string;
  candidatesBeforeFilter: number;
  excludedBy: { reason: string; count: number; examples: string[] }[];
  conflictWith?: string;   // "專題研究（二） 五 2-4"
  suggestion: string;      // 放寬哪個條件可能有解
};
```

無解時自動重試一次，放寬順序：`maxCredits` → `avoidDays` → 允許 `extracted` 先修未過但標示風險。放寬後仍無解才回報。**放寬了什麼一定要寫在 trace 與 UI 上。**

---

## 6. Trace 儲存與去識別

```sql
traces (
  id uuid primary key,
  created_at timestamptz,
  student_hash text,          -- HMAC-SHA256(學號, SERVER_SECRET)，不可逆
  rule_pack_id text,
  rule_pack_version text,
  total_ms int,
  status text,                -- ok | held | error
  llm_calls int,
  llm_cost_usd numeric
);

trace_steps (
  trace_id uuid, idx int, name text, status text,
  summary text, ms int, retries int,
  primary key (trace_id, idx)
);

tool_calls (
  trace_id uuid, step_idx int, seq int,
  name text, input_json jsonb, output_json jsonb,
  ms int, status text, error text
);

blocked_content (
  trace_id uuid, source_url text, excerpt text,
  pattern_matched text, blocked_at timestamptz
);
```

### 去識別規則

- `student_hash` 用 HMAC，secret 存環境變數，不可逆推
- `input_json` / `output_json` 寫入前過一層 scrubber：移除姓名、學號、Email、電話
- 課程名稱、成績可以留（那是判定依據，且無法單獨識別個人）
- trace 保留 90 天後自動刪除

決賽要交至少一份可查核的 trace，直接從這三張表匯出成 JSON 即可。

---

## 7. LLM 使用邊界

**只有三處允許呼叫 LLM：**

| 位置 | 用途 | 時機 |
|---|---|---|
| 規則抽取 | PDF → RulePack 草稿 | 離線 |
| `rule.reconcile` | 判斷公告是否適用本學籍 | 執行期 |
| 情境試算意圖解析 | 自然語言 → Scenario | 執行期 |

執行期兩處的共同要求：

```ts
{
  temperature: 0,
  response_format: structured,      // 必須有 schema
  max_tokens: 1024,
  timeout_ms: 8000,
}
```

- 輸出必須通過 schema 驗證，驗證失敗 → 重試一次 → 仍失敗 → 降級為 HoldItem 或請使用者澄清
- **每次審查的 LLM 呼叫上限 3 次**，超過即中止並記錄
- 每次呼叫記 token 數與成本進 trace（評測報告要報成本）

`credit.audit`、`schedule.solve`、`citation.verify` **任何情況下都不得呼叫 LLM**。這三個是確定性運算，是不幻覺的保證。這條要寫進 CI：掃描這三個模組的 import，出現 LLM client 就 fail build。

---

## 8. 快取與延遲目標

| 資料 | 策略 |
|---|---|
| RulePack | 啟動時載入記憶體 |
| 開課資料 | Postgres + index，查詢 < 50ms |
| 審查結果 | key = `hash(studentRecord) + rulePackVersion`，TTL 10 分鐘 |
| `web.retrieve` | 結果快取 7 天；**Demo 前預熱離線快照** |

### 延遲目標

- P50 < 4s（不含 `web.retrieve`）
- P95 < 8s
- `web.retrieve` 逾時 3s 即放棄，標記 partial，不阻塞主結果

前端要能**先渲染審查結果，討論資料後到**。這既是體驗，也讓評測報告上的延遲數字好看。

---

## 9. 錯誤處理總表

| 情況 | 行為 |
|---|---|
| Provider 取不到資料 | 中止，回錯誤頁，不顯示部分結果 |
| `admissionYear !== actualAdmissionYear` | 整案轉人工，不做任何學分判定 |
| 找不到對應 RulePack | 中止，明確告知「尚未支援此系所／學年度」 |
| 不變式檢查失敗 | 中止並記錄，**絕不輸出結果** |
| `citation.verify` 失敗 ×2 | 該條降級為 HoldItem |
| 指派問題無最佳解 | 理論上不會發生；若發生，中止並記錄 |
| 求解器無解 | 回報 Infeasibility，不回空清單 |
| `web.retrieve` 失敗 | 標記 partial，主結果照常 |
| LLM 呼叫超過上限 | 中止，記錄 |

原則：**寧可中止並說明，不輸出可能錯誤的結果。**

---

## 10. CI 檢查（寫進 pipeline）

```
1. 不變式測試：countable + inProgress + unmet === minCredits
2. 指派決勝穩定性：同一輸入跑 100 次，結果完全一致
3. golden set 回歸：正確率不得下降
4. 模組邊界：audit / solver / verify 不得 import LLM client
5. 時段解析語料：500 筆全數通過
6. 注入測試語料：攔截率不得下降
7. 掃描原始碼與設定檔，不得含金鑰或真實學號
```

第 4 條是整個專案最重要的一條，因為它用機械方式保證了「算數的那層沒有模型」這個技術主張。答詢時可以直接把 CI 設定調出來給評審看。
