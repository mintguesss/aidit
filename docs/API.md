# API 契約

本文件是**前後端的分界線**。前端只透過這裡列出的端點取得資料；後端只要維持這些
形狀，內部怎麼換實作都不影響前端。要改任何一個形狀，先改這份文件並讓對方知道。

所有端點都是 `runtime = "nodejs"`、`dynamic = "force-dynamic"`。
回應一律 JSON（`/api/corpus`、`/api/offering` 例外，見各節）。

錯誤格式統一為 `{ "error": "中文說明" }`，狀態碼含意：

| 碼 | 意思 |
|---|---|
| 400 | 請求格式不對（JSON 壞掉、缺必填欄位） |
| 404 | 查無此資源 |
| 409 | 狀態衝突（例：規則包尚有未通過項目就要鎖版） |
| 413 | 上傳檔案過大 |
| 415 | 不支援的檔案型別 |
| 422 | 請求合法但**無法產出可信結果**，已中止。不回半套答案 |
| 429 | 超出單輪 LLM 呼叫預算 |
| 500 | 伺服器端錯誤 |

422 是這個系統最重要的一個碼。判定引擎寧可中止並說明理由，也不輸出可能算錯的
結果 —— 前端要把 `error` 原文顯示給使用者，不要自己改寫或吞掉。

---

## 共同參數

多數端點接受 `fixture` 與 `term`，語意與頁面網址上的查詢字串相同，用來指定
要跑哪一份測試案例、以哪一學期為現在。兩者都會經
[`parsePageParams`](../src/lib/ui/params.ts) 正規化，非法值會退回預設。

後端把 mock provider 換成真實資料源之後，`fixture` 的角色會改變 ——
那是要一起討論的第一件事，見 [CONTRIBUTING.md](../CONTRIBUTING.md)。

---

## 判定

### `POST /api/audit` — 執行審查

```jsonc
// 請求
{ "providerKind": "mock" | "upload", "payload": {}, "fixture": "demo", "currentTerm": "114-1" }
// 200
{ "audit": AuditResult, "plans": Plan[], "trace": Trace }
// 422（中止）
{ "traceId": "…", "kind": "…", "error": "中止原因", "steps": TraceStep[] }
```

`providerKind` 只收 `mock` 與 `upload`。`api`（代為登入校務系統）是刻意不實作的，
見 [`src/lib/providers/index.ts`](../src/lib/providers/index.ts)。

中止原因為 `all-hold`（全數待人工確認）時回 **200 而非 422** —— 那是一個有效的
判定結果，不是失敗。

### `POST /api/extra-goals` — 額外修業目標的修課現況

```jsonc
{ "fixture": "demo", "term": "114-1", "goals": [{ "kind": "minor" | "double-major" | "cert-program" | "transfer", "target": "資訊管理" }] }
→ { "rows": ExtraGoalRow[] }
```

目標存在使用者瀏覽器的 localStorage，所以由前端帶上來；已註冊的目標則由學籍資料
決定，不需要前端傳。最多 4 個，`target` 截斷至 20 字。**這條路徑不含 LLM。**

---

## 選課

### `POST /api/plan` — 依選課傾向產生課表

```jsonc
{ "fixture": "demo", "term": "114-1", "preferences": CoursePreferences, "optional": OptionalPreferences }
→ { "traceId", "plans": Plan[], "preferences", "constraints": ConstraintSet,
    "appliedConstraints": string[], "excluded": { candidatesBeforeFilter, excludedBy },
    "message"? }
```

**這條路徑不含 LLM**：輸入是結構化偏好，輸出是求解器結果。逐輪的對話式微調走
`/api/chat`。各類別都已滿足時回空的 `plans` 加一句 `message`。

### `POST /api/whatif` — 情境試算

```jsonc
{ "fixture": "demo", "term": "114-1", "scenario": "我想在 115-1 畢業" }
→ { "kind": "result",       "traceId", "scenario", "result", "llm" }
→ { "kind": "clarify",      "question", "llm" }
→ { "kind": "out-of-scope", "message",  "llm" }
```

LLM 只負責把自然語言解析成結構化 `scenario`；試算本身由引擎做。解析不出來就回
`clarify` 問清楚，**不猜**。

---

## 對話

### `POST /api/chat` — 兩個對話介面共用

```jsonc
{ "fixture", "term", "scope": "plan" | "ask", "messages": ChatMessage[], "constraints": ConstraintSet }
→ { "reply": { kind: "決定" | "不確定" | …, headline, detail, searched, contact, citations },
    "text", "intent", "clarifying", "tools": string[], "traceId", "llm",
    "explanation"?, "whatif"?, "redirect"?,
    "plan"?: { plans, conflicts?, excluded, constraints, constraintLabels, changed, diff, costs, relaxOptions } }
```

`scope: "plan"` 是課表微調，`"ask"` 是修業問答。契約細節見
[CONVERSATION.md](../CONVERSATION.md)，其中三條對後端最要緊：

- **§0.1** LLM 只輸出意圖與參數；回覆文字一律由 `compose.ts` 從引擎結果組出來。
  回應裡的 `text` 不是模型寫的。
- **§0.7** 每輪 LLM 呼叫上限 2 次（超過回 429），單一 session 上限 20 輪。
- 前端送上來的 `constraints` 一律當**不可信輸入**，由 route 內的 `sanitise()`
  逐欄位夾限後才進求解器。

案件已轉人工審查時回 200，`reply.kind` 為「不確定」—— 不是錯誤。

---

## 規則包與校對

### `POST /api/rulepack` — 上傳（`multipart/form-data`）

`.json`（規則包格式）→ `{ "kind": "json", "ok": bool, "issues": [...] }`，
即使驗證失敗也回 200，因為「檢查出問題」本身就是這個端點的正常輸出。

`.pdf`（原始規劃表）→ `{ "kind": "pdf", "ok": true, "receipt", "filename", "bytes", "steps" }`。
只留檔案指紋與暫存檔，抽取流程是離線的三支腳本，不在這條路徑上跑。

其他副檔名回 415，超過大小上限回 413。

### `POST /api/review` — 人工校對寫入

```jsonc
{ "action": "decide", "packId": "im-111", "decision": { itemId, status, … } } → { "record" }
{ "action": "lock",   "packId": "im-111", "reviewer": "姓名或代號" }         → { "ok": true, "path" }
```

尚有未通過項目就鎖版會回 409。**這是內部作業端點，目前沒有任何身分驗證** ——
正式部署必須置於內部網段或加上驗證，這件事列在後端待辦。

---

## 查核

### `GET /api/trace/:id`

```jsonc
{ "steps": TraceStep[], "toolCalls": [{ stepIdx, name, input, output, ms, status }],
  "blockedContent": [...],
  "meta": { id, createdAt, studentHash, rulePackId, rulePackVersion, totalMs, status, llm, abortReason } }
```

查無或逾 90 天保留期限回 404。`studentHash` 是 HMAC，不可逆推。

### `GET /api/corpus/:docId` — 原文回查

回**純文字**（不是 JSON），開頭附標題與發布日期。用於把引用帶回原文。
文件存在但沒有語料檔時，404 的訊息會明確說「未提供原文語料檔」而不是「查無文件」，
因為這兩件事對使用者的意義不同。

### `GET /api/offering/:code` — 開課資料

回 JSON，同時給 `raw`（抓取當下的原始列）與 `normalized`（正規化後的形狀），
方便比對正規化有沒有失真。目前是**合成資料**，回應中的 `note` 欄位會講明這件事；
後端接上真實來源時，這個欄位要跟著改。

---

## 偏好（涉及資料主體權利）

### `POST /api/preferences`

```jsonc
{ "fixture", "term", "required": CoursePreferences, "optional": OptionalPreferences }
→ { "ok": true, "stored": {…} }
```

以 `studentHash` 為鍵存在伺服器端。無法識別學籍時回 422。

### `DELETE /api/preferences`

```jsonc
{ "scope": "optional" | "preferences" | "all" } → { "ok", "scope", "traces"? }
```

`scope: "all"` 會**連同該學生的執行紀錄一起刪除**，回應中的 `traces` 是刪除筆數。
執行紀錄是系統對自己判定的稽核證據，刪掉之後「當初系統告訴我什麼、依據是什麼」
就再也查不到 —— 前端必須把這個代價講清楚再送出，不能當成無害的清理動作。

偏好之所以存在伺服器端而不是只放 localStorage，理由寫在
[`src/lib/store/prefs-store.ts`](../src/lib/store/prefs-store.ts) 的檔頭，值得先讀。
