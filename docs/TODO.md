# 待辦

依「會不會擋住別人」排序，不是依難度。勾選後請一併更新，這份是兩個人共用的狀態。

---

## A. 待決定（先決定，否則下游會做白工）

- [ ] **A1　偏好要不要留在伺服器端**
      現況是留（SPEC-CHANGES **E60**，你自己提的：「不然都在本地的話要刪除功能幹嘛」）。
      決定「留」→ 做 B2；決定「改回本地」→ 要拆掉 `prefs-store.ts`、
      `/api/preferences` 的 DELETE、隱私頁四項控制裡的三項，並補一條 E65 記錄反轉。
      **注意**：偏好現在已經在伺服器上了，B2 不是新增落地，是讓它真的留得住。

- [ ] **A2　`fixture` 參數接真實資料後的角色**
      現在同時是「選哪份測試案例」和「選哪個學生」，接真實資料源後會分家。
      牽動 [API.md](API.md) 大部分端點，**前後端要一起談**。

- [ ] **A3　課表要不要能儲存**
      現在不存，每次重算。要做的話是新功能，且屬於學生資料，要先過 A1 的同一套判準。

- [ ] **A4　最終驗證數據用哪個模型**
      決定了才知道哪一份評測報告是要交出去的那一份。見 D2。

## B. 儲存層

- [ ] **B1　Vercel 接上 Supabase**
      本機已驗證可用（insert／select／cascade 刪除全過）。線上兩個環境變數
      讀不到，查 Environment 有沒有勾 Production。打 `/api/health` 確認。
- [ ] **B2　`prefs-store` 的 Supabase 實作**（取決於 A1）
      線上存 `/tmp`，使用者設定完重新整理就不見 —— 現在是壞的。
- [ ] **B3　規則包與語料搬到儲存層**
      鎖版現在寫進 `src/lib/rules/packs/`（原始碼目錄），serverless 唯讀必然失敗。
      **`loadCorpus()` 保持同步**，用冷啟動預載，別改成 async（會傳染到審查引擎）。
- [ ] **B4　校對紀錄與上傳暫存搬到儲存層**
      含校對人姓名，且 `/tmp` 上留不住。

## C. 真實資料

- [ ] **C1　實際修業規定進系統**
      PDF → 分段 → 抽取 → 自動驗證 → 人工校對 → 鎖版，流程見 BACKEND.md §2。
      `scripts/extract-rulepack.ts` 需要 `ANTHROPIC_API_KEY`，沒有離線替身。
- [ ] **C2　課綱原文語料**
      每條結論都要能回查原文，沒有語料的文件其引用無法驗證，會降級成待確認。
- [ ] **C3　開課資料抓取與正規化**
      時段字串解析、擋修資料、抓取策略，BACKEND.md §4。現在是合成資料。
- [ ] **C4　`CourseRecordProvider` 接校務系統**
      取決於 A2。`api` kind 目前刻意 throw —— 本系統不代為登入校務系統。

## D. 模型

- [ ] **D1　家用主機接 Ollama**
      [SELFHOST.md](SELFHOST.md) 已寫好。4070 Ti 12GB 跑 `qwen3:14b`。
      打 `/api/health` 確認 `llm.available` 是 `true` ——
      **`false` 代表在跑確定性替身，頁面一切正常但模型根本沒被呼叫到。**
- [ ] **D2　模型比較測試**
      `npm run eval` 換不同 `AIDIT_LLM_MODEL` 各跑一次，比正確率、錯答率、
      轉人工率。報告標頭會印 `MODEL_LABEL`。
      **不同模型的數字不能放在同一張表上，各跑各的。**
- [ ] **D3　壓測降級路徑**
      離線替身永遠回傳完美形狀，所以「模型亂回 → schema 驗證失敗 → 重試 →
      降級成待確認」這條路從來沒被真實模型的雜訊測過。那是零錯答主張的最後
      一道防線，用本機模型才驗得到（Opus 5 幾乎不吐壞形狀，反而測不到）。

## E. 安全

- [ ] **E1　身分驗證**
      現在**完全沒有**：沒有 middleware，`/api/review` 能鎖規則包版本。
      在做出來之前，自架的那台只能待在 Tailscale 內網，不要 port forwarding。
- [ ] **E2　`/api/review` 加驗證或限制到內部網段**
      端點自己的註解就寫了這件事。

## F. 文件債

- [ ] **F1　修 [ui/prefs.ts](../src/lib/ui/prefs.ts) 的過時註解**
      檔頭還停留在 E58，寫「偏好的保存位置：使用者自己的瀏覽器…伺服器完全不
      持有這份資料」，但 E60 已經反轉成伺服器端。**跟現在的行為不符。**
      等 A1 決定後一併改成正確的版本。

---

## 已完成（留著當紀錄）

- [x] 上 GitHub、Vercel 自動部署、CI（七項＋build）
- [x] `traces` 的 Supabase migration，本機來回測試通過
- [x] 模型可切換（Anthropic／OpenAI 相容），定價隨模型走
- [x] `/api/health` —— 錯誤設定多半是靜默的，這條把實際狀態講出來
- [x] 修 Node 20 下 supabase-js 因缺原生 WebSocket 連不上
- [x] 文件整理：CONTRIBUTING／HANDOVER 去重、README 索引、[DATA.md](DATA.md) 盤點
