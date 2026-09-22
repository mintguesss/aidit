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
AIDIT_TRACE_SECRET=（跟 Vercel 用同一組，否則同一個學生會算出不同 hash）
```

`AIDIT_DATA_DIR` **留空** —— 那是 Vercel 專用的，這台機器該用預設的 `<專案>/.data`。

逾時預設會自動從 8 秒放寬到 30 秒（`AIDIT_LLM_TIMEOUT_MS` 可再調）。8 秒是照
BACKEND.md §8 的 P95 目標訂的，對託管 API 合理，對本機模型的首 token 延遲不夠。

```powershell
npm ci
npm run build
npm i -g pm2 pm2-windows-startup
pm2-startup install
pm2 start npm --name aidit -- start
pm2 save
```

`npm start` 預設只綁 `127.0.0.1`，別的裝置連不到。要讓其他裝置連進來，
在 `package.json` 把 `start` 改成 `next start -H 0.0.0.0`，並在 Windows 防火牆
放行 3000 埠。

## 三、其他裝置怎麼連

**用 Tailscale。** 這不只是方便 —— 這個系統**完全沒有身分驗證**
（沒有 middleware，`/api/review` 能鎖規則包版本），所以它只能待在私有網路裡。

伺服器和手機、筆電各裝一個，每台裝置拿到固定的 `100.x.y.z`，互相連得到，
但對外沒有開任何埠。CGNAT 後面也能用，不用設路由器、不用固定 IP、不用 DDNS。
連上之後就是 `http://100.x.y.z:3000`。

只在家裡用的話，區網 IP 也行，記得在路由器給那台機器綁 DHCP 保留位址。

**不要做 port forwarding。** 要公開就得先做 auth，那是另一件事。

## 四、更新

遠端連進去，在專案根目錄：

```powershell
.\scripts\deploy.ps1
```

它會擋下未提交的改動（部署機器不該在上面直接改東西）、`git pull --ff-only`、
`npm ci`、build、`pm2 restart`，最後打 `/api/health` 確認起得來。
沒有新 commit 就直接結束，不做無謂的重建。

## 五、確認真的接上了

```powershell
curl http://127.0.0.1:3000/api/health
```

```jsonc
{
  "store": { "kind": "file", "dataDir": "…/.data" },
  "llm": { "provider": "openai-compatible", "model": "openai-compatible:qwen3:14b",
           "available": true, "timeoutMs": 30000 }
}
```

`llm.available` 必須是 `true`。**如果是 `false`，系統正在跑確定性替身，
頁面一切正常，但你以為在測的模型根本沒被呼叫到** —— 這是最容易自欺的失敗模式，
所以每次改完設定都看一下這條。

## 六、拿它來做什麼

不是為了省錢（離線替身本來就免費，而且更快更確定）。真正的理由：

**離線替身永遠回傳完美形狀，所以它從來沒測過「模型亂回 → schema 驗證失敗
→ 重試 → 降級成待確認」這條路徑。** 那是「零錯答」主張的最後一道防線，
只有接真實模型才驗得到，而 Opus 5 幾乎不會吐出壞形狀，反而測不到。

跑 `npm run eval`，報告標頭會印出實際使用的模型。

**但別拿本機模型的數字當最終驗證數據。** 小模型轉人工率會高不少，而且免費層
與開源模型會改版、會下架，數字不可重現 —— 而整份評測的價值就建立在可重現上。
最終那張表要用你實際出貨的模型跑。
