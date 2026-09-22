# 家用主機專用 —— Vercel 不需要，它自己會從 GitHub 建置。
#
# 用法：遠端（Tailscale）連進主機後在專案根目錄執行
#     .\scripts\deploy.ps1
#
# 前置設定只做一次：
#     npm i -g pm2 pm2-windows-startup
#     pm2-startup install
#     pm2 start npm --name aidit -- start
#     pm2 save

$ErrorActionPreference = "Stop"

function Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }

# 未提交的改動會被 git pull 擋下來，先講清楚而不是讓 git 丟一段難讀的錯誤
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "工作目錄有未提交的改動：" -ForegroundColor Yellow
    Write-Host $dirty
    Write-Host "先 commit 或 stash 再跑。這台機器是部署目標，不該在上面直接改東西。" -ForegroundColor Yellow
    exit 1
}

Step "拉取更新"
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
# 給 Next.js 一點啟動時間
Start-Sleep -Seconds 3
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 10
    Write-Host ("store : {0} ({1})" -f $health.store.kind, $health.store.detail)
    Write-Host ("llm   : {0}  available={1}" -f $health.llm.model, $health.llm.available)
    if ($health.ok) {
        Write-Host "`n部署完成。" -ForegroundColor Green
    } else {
        Write-Host "`n服務起來了，但健康檢查沒過（見上方）。" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "`n健康檢查連不上：$_" -ForegroundColor Red
    Write-Host "看 pm2 logs aidit 找原因。" -ForegroundColor Red
    exit 1
}
