# 自架：家用主機跑本機模型

> **這份只適用於家用主機那台。** Vercel 的公開 demo 不看這份，看
> [DEPLOY.md](DEPLOY.md)；兩邊的環境變數不一樣，不要互抄。

## 兩套部署在幹嘛

| | Vercel | 家用主機 |
|---|---|---|
| 用途 | 公開 demo，隨時能看 | 跑真模型、跑評測、開發 |
| 模型 | 無，走確定性替身 | Ollama 本機模型 |
| 對外 | 公開網址 | 只在 Tailscale 內網 |
| 更新 | push 後自動建置 | 遠端進去跑 `deploy.ps1` |

公開 demo 刻意不接模型：離線替身是確定性的，展示時每次結果一樣，
也不會因為額度或速率限制在評審面前掛掉。

**不要讓 Vercel 去呼叫家裡的 Ollama。** 那表示 Ollama 要對整個網際網路開放，
而 Ollama 沒有任何驗證機制 —— 誰連得到誰就能用你的顯卡。

## 一、Ollama

```powershell
# 裝 Windows 原生版（吃得到顯卡），然後拉模型
ollama pull qwen3:14b
```

12GB VRAM 跑 `qwen3:14b`（Q4，約 9GB）剛好，結構化輸出的遵循率比 8B 好一截。
VRAM 更緊就退 `qwen3:8b`。

**`OLLAMA_HOST` 維持預設的 `127.0.0.1`。** 它跟 app 在同一台，走 localhost 就好；
設成 `0.0.0.0` 等於把一個無驗證的推論服務攤開在網路上。

## 二、app

`.env`（不進版控）：

```
AIDIT_LLM_PROVIDER=openai-compatible
AIDIT_LLM_BASE_URL=http://127.0.0.1:11434/v1
AIDIT_LLM_MODEL=qwen3:14b
AIDIT_LLM_REASONING_EFFORT=none
AIDIT_TRACE_SECRET=（跟 Vercel 用同一組，否則同一個學生會算出不同 hash）
```

`AIDIT_DATA_DIR` **留空** —— 那是 Vercel 專用的，這台機器該用預設的 `<專案>/.data`。

`AIDIT_LLM_REASONING_EFFORT=none`：qwen3 是思考型模型，預設會先想一大段再輸出。
實測一次意圖解析 14 秒、常超過逾時；設 `none` 後 1.2 秒，輸出相同。
意圖解析只是分類加抽參數，用不到長鏈推理。

逾時預設會自動從 8 秒放寬到 30 秒（`AIDIT_LLM_TIMEOUT_MS` 可再調）。8 秒是照
BACKEND.md §8 的 P95 目標訂的，對託管 API 合理，對本機模型的首 token 延遲不夠。

### 綁定位址：只綁 Tailscale

**`next start` 沒給 `-H` 時綁的是所有網卡**（`0.0.0.0` 與 `[::]`），不是 127.0.0.1。
這台機器若有公開 IP（校園網路常見），照預設啟動就等於把一個**沒有身分驗證**的服務
開在網際網路上 —— 而且它帶著 E3 那個漏洞：任何人都能讀、寫、刪指定學生的偏好
與執行紀錄。

所以一律**明確綁 Tailscale 的位址**。先查這台的位址：

```powershell
tailscale ip -4          # 例如 100.96.82.49
```

綁定特定位址之後，socket 只接受連到那個位址的連線。就算防火牆放行了 node.exe，
公開網路也連不到。

### 常駐：pm2 直接跑 next

```powershell
npm ci
npm run build
npm i -g pm2 pm2-windows-startup
pm2-startup install
pm2 start node_modules/next/dist/bin/next --name aidit --exp-backoff-restart-delay=1000 -- start -H 100.x.y.z
pm2 save
```

`100.x.y.z` 換成上面查到的位址。

**不要用 `pm2 start npm -- start`**：Windows 上 pm2 會把 `npm.cmd` 當 JS 解析，
`SyntaxError` 後反覆重啟到 `errored`；就算改用 `npm-cli.js`，npm 另開的 `cmd.exe`
會掛出一個關不掉的主控台視窗。直接跑 next 就沒有這些問題。

**開機順序**：pm2 若比 Tailscale 先起來，綁 Tailscale 位址會失敗（EADDRNOTAVAIL）。
`--exp-backoff-restart-delay` 讓 pm2 失敗後隔一段時間再試、間隔逐次拉長到 15 秒，
不會像預設那樣連續快速重啟十幾次就放棄變成 `errored`；Tailscale 一起來就綁得上。
仍是 `errored` 的話 `pm2 restart aidit`。已經用舊指令起的服務要 `pm2 delete aidit` 後用上面的指令重起、再 `pm2 save`。

## 三、其他裝置怎麼連

**用 Tailscale。** 這不只是方便 —— 這個系統**完全沒有身分驗證**
（沒有 middleware，`/api/review` 能鎖規則包版本），所以它只能待在私有網路裡。

伺服器和手機、筆電各裝一個，每台裝置拿到固定的 `100.x.y.z`，互相連得到，
但對外沒有開任何埠。CGNAT 後面也能用，不用設路由器、不用固定 IP、不用 DDNS。
連上之後就是 `http://100.x.y.z:3000`。

因為只綁 Tailscale 位址，**localhost 與區網都連不到，這是刻意的**。不要為了方便
改綁區網 IP：校園網路的「區網」常常就是公開網路。

**不要做 port forwarding。** 要公開就得先做 auth，那是另一件事。

## 四、更新

遠端連進去，在專案根目錄：

```powershell
.\scripts\deploy.ps1
```

它會先確認你在 `main` 分支上（在測試用的分支上會停下來，要照樣部署就加
`-AllowBranch`），擋下未提交的改動（部署機器不該在上面直接改東西），然後
`git pull --ff-only`、`npm ci`、build、`pm2 restart`，最後打這台實際綁定的
Tailscale 位址上的 `/api/health` 確認起得來。沒有新 commit 就直接結束，不做無謂的重建。

## 五、確認真的接上了

```powershell
Invoke-RestMethod http://100.x.y.z:3000/api/health
```

```jsonc
{
  "store": { "kind": "supabase", "ok": true },
  "llm": { "provider": "openai-compatible", "model": "openai-compatible:qwen3:14b",
           "available": true, "timeoutMs": 30000, "reasoningEffort": "none" }
}
```

**`llm.available` 只代表有設定**（`openai-compatible` 時就是 `AIDIT_LLM_BASE_URL` 有值），
不代表 Ollama 連得到。`false` 確定是在跑離線替身；`true` 只是必要條件。

真正能證明模型被呼叫到的，是會用到模型的請求回傳的用量：

```powershell
$r = Invoke-RestMethod -Method Post -Uri http://100.x.y.z:3000/api/whatif `
  -ContentType "application/json; charset=utf-8" -Body '{"scenario":"我想在 115-1 畢業"}'
$r.llm.calls
```

**大於 0 才算。** 等於 0 代表模型沒被呼叫到 —— 頁面一切正常，但你以為在測的模型
根本沒上場。這是最容易自欺的失敗模式，每次改完設定都看一下。

## 六、拿它來做什麼

不是為了省錢（離線替身本來就免費，而且更快更確定）。真正的理由是：
**離線替身只會做它被寫好的事，真實模型的錯法得實際跑才看得到。**

原本預期的危險是「模型吐出壞形狀 → schema 驗證失敗」。實測 qwen3:14b 正好相反：
它幾乎不吐壞形狀，真正的問題是**形狀完全合法、內容是編的** —— 把使用者沒提到的
欄位填成 `false`、`0`，於是「空出星期五」關掉了使用者原本的「不排早八」，學分上限
被設成 0。schema 驗證擋不住這種錯。

現在的防線是程式要求參數值必須在原句找得到、解除既有偏好必須有依據，被擋下的
參數記進 trace（[apply.ts](../src/lib/chat/apply.ts)）。這些都是接了真實模型才找得到的。

端到端測試，照前端的送法打 `/api/chat`，每句檢查回覆與四條不變式：

```powershell
npm run chat:e2e -- http://100.x.y.z:3000 "標籤"
```

模型輸出不穩定，**至少跑兩輪**。

`npm run eval` 會讀 `.env`、用設定的模型跑評測，報告標頭會印出實際使用的模型。
`npm run ci` 則**一律離線**、不讀 `.env` —— 它是回歸閘門，要跟 GitHub Actions 測同一件事。

**但別拿本機模型的數字當最終驗證數據。** 小模型轉人工率會高不少，而且免費層
與開源模型會改版、會下架，數字不可重現 —— 而整份評測的價值就建立在可重現上。
最終那張表要用你實際出貨的模型跑。

### 顯卡被別的程式佔用時

qwen3:14b 約 10 GB，顯卡 12 GB。另一個要用顯卡的程式同時開著就會搶：實測連續
十個請求卡滿 30 秒逾時。現在模型失敗會退回規則式解析（trace 記 `rule.degraded`），
對話不會整輪失敗，但那幾輪等於沒用到模型。

```powershell
pm2 stop aidit          # 暫停服務，不會再有請求把模型載入顯卡
ollama stop qwen3:14b   # 立刻卸載（否則最後一次請求後保留 5 分鐘）
ollama ps               # 空的＝沒佔顯卡
```
