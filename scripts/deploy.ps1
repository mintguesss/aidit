# 家用主機專用 —— Vercel 不需要，它自己會從 GitHub 建置。
#
# 用法：遠端（Tailscale）連進主機後在專案根目錄執行
#     .\scripts\deploy.ps1
#     .\scripts\deploy.ps1 -AllowBranch   # 在 main 以外的分支上照樣部署（測試用）
#
# 前置設定只做一次（詳見 docs/SELFHOST.md §二）：
#     npm i -g pm2 pm2-windows-startup
#     pm2-startup install
#     pm2 start node_modules/next/dist/bin/next --name aidit --exp-backoff-restart-delay=1000 -- start -H <Tailscale 位址>
#     pm2 save
#
# 不要用 `pm2 start npm -- start`：Windows 上 pm2 會把 npm.cmd 當 JS 解析，
# 反覆重啟到 errored。也不要省略 -H：next start 預設綁所有網卡，不是 127.0.0.1。

param(
    [switch]$AllowBranch
)

$ErrorActionPreference = "Stop"

function Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }

# 修正分支測完、合進 main 之後，這台常常還停在那個測試分支上。
# 在那裡 git pull 拉到的是舊分支，部署出去的就不是 main —— 而且不會有任何錯誤訊息。
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main" -and -not $AllowBranch) {
    Write-Host "目前在 $branch 分支，不是 main。" -ForegroundColor Yellow
    Write-Host "要部署 main：git checkout main 後再跑一次。" -ForegroundColor Yellow
    Write-Host "要照樣部署這個分支（測試用）：加上 -AllowBranch。" -ForegroundColor Yellow
    exit 1
}

# 未提交的改動會被 git pull 擋下來，先講清楚而不是讓 git 丟一段難讀的錯誤
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "工作目錄有未提交的改動：" -ForegroundColor Yellow
    Write-Host $dirty
    Write-Host "先 commit 或 stash 再跑。這台機器是部署目標，不該在上面直接改東西。" -ForegroundColor Yellow
    exit 1
}

Step "拉取更新（$branch）"
$before = git rev-parse HEAD
git pull --ff-only
$after = git rev-parse HEAD

if ($before -eq $after) {
    Write-Host "已是最新版本，不需要重新建置。" -ForegroundColor Green
    exit 0
}

Step "安裝相依套件"
# 用 ci 不用 install：嚴格照 lockfile，部署機器不該自己決定版本
npm ci

Step "建置"
npm run build

Step "重啟"
pm2 restart aidit --update-env
pm2 save

Step "健康檢查"
# 服務只綁 Tailscale 位址（docs/SELFHOST.md §二），打 127.0.0.1 永遠連不到。
# 找不到 tailscale 指令時才退回 127.0.0.1（沒裝 Tailscale 的機器）。
$addr = $null
try { $addr = (tailscale ip -4 | Select-Object -First 1) } catch { }
if (-not $addr) { $addr = "127.0.0.1" }
$addr = "$addr".Trim()

# 給 Next.js 一點啟動時間
Start-Sleep -Seconds 3
try {
    $health = Invoke-RestMethod -Uri "http://${addr}:3000/api/health" -TimeoutSec 10
    Write-Host ("位址  : {0}" -f $addr)
    Write-Host ("store : {0} ({1})" -f $health.store.kind, $health.store.detail)
    # available 只代表有設定，不代表模型連得到。要確認見 docs/SELFHOST.md §五
    Write-Host ("llm   : {0}  已設定={1}" -f $health.llm.model, $health.llm.available)
    if ($health.ok) {
        Write-Host "`n部署完成。" -ForegroundColor Green
    } else {
        Write-Host "`n服務起來了，但健康檢查沒過（見上方）。" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "`n健康檢查連不上 http://${addr}:3000 ：$_" -ForegroundColor Red
    Write-Host "看 pm2 logs aidit 找原因；pm2 若比 Tailscale 先起來，綁定會失敗。" -ForegroundColor Red
    exit 1
}
