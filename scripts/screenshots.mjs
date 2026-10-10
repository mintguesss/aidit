/**
 * 系統截圖。
 *
 * 產出 docs/screenshots/ 下的完整畫面存檔，供報告、簡報與交付使用。
 * 刻意寫成可重跑的腳本而不是手動截圖：介面改了就重跑一次，
 * 免得文件裡的圖與實際系統對不上 —— 那比沒有圖更誤導。
 *
 * 一頁最多兩到三張（桌機、手機，必要時加一張互動狀態），不做逐元件的細部截圖。
 *
 * 用法：
 *   npm run dev            （另一個視窗）
 *   node scripts/screenshots.mjs
 */
import { chromium } from "playwright-core";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.UI_BASE ?? "http://localhost:3000";
const FIXTURE = process.env.SHOT_FIXTURE ?? "demo";
const TERM = process.env.SHOT_TERM ?? "114-2";
const Q = `?fixture=${FIXTURE}&term=${TERM}`;
const OUT = join(process.cwd(), "docs", "screenshots");

/**
 * 截全頁時把 sticky 頂條與對話區的內捲關掉：
 * 否則頂條會壓在圖的中間，對話也只截得到最後一輪。
 */
const PATCH = `
  .topbar{position:static !important}
  .msgr-log{max-height:none !important}
`;

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

const shots = [];

async function capture(page, name, title, fullPage = true) {
  const file = `${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage });
  shots.push({ file, title });
  console.log(`  ${file}`);
}

async function go(page, path, fixture = FIXTURE) {
  await page.goto(`${BASE}${path}?fixture=${fixture}&term=${TERM}`, { waitUntil: "networkidle" });
  // 額外目標與偏好是掛載後才向伺服器取的，等它回來畫面才完整
  await page.waitForTimeout(2200);
  await page.addStyleTag({ content: PATCH });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true }).catch((e) => {
  console.error("無法啟動 Edge：", e.message);
  process.exit(2);
});

// ------------------------------------------------------------ 桌機
console.log("桌機 1280px");
{
  const ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  await go(page, "/");
  await capture(page, "01-home", "首頁：判定結論、修業進度、接下來");

  await go(page, "/audit");
  await capture(page, "02-audit", "修業明細：逐類別比對");
  await page.locator("button.chev").nth(1).click().catch(() => {});
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: PATCH });
  await capture(page, "03-audit-expanded", "修業明細：展開採計科目、分項規定與依據");

  await go(page, "/holds");
  await capture(page, "04-holds", "待確認事項：收起只看事項、影響、找誰；可記錄自己的處理進度");

  // 課表在彈出視窗裡：彈出視窗是固定定位，拍視窗範圍而不是整頁
  await go(page, "/plan");
  await page.getByRole("button", { name: "查看建議課表" }).click();
  await page.waitForTimeout(500);
  await capture(page, "05-plan-grid", "選課建議：週課表（彈出視窗）", false);
  await page.getByRole("button", { name: "清單" }).click().catch(() => {});
  await page.waitForTimeout(400);
  await capture(page, "06-plan-list", "選課建議：清單檢視（彈出視窗）", false);

  await go(page, "/plan");
  for (const t of ["空出星期五", "為什麼沒有選企業流程管理"]) {
    await page.locator("textarea").last().fill(t);
    await page.getByRole("button", { name: "送出" }).click();
    await page.waitForTimeout(3500);
  }
  await page.addStyleTag({ content: PATCH });
  await capture(page, "07-plan-chat", "課表微調對話：每輪回報改了什麼、差異、代價");

  await go(page, "/assistant");
  for (const t of ["我還差多少學分才能畢業？", "抵免要怎麼申請？", "幫我猜一下我這學期會不會被當"]) {
    await page.locator("textarea").last().fill(t);
    await page.getByRole("button", { name: "送出" }).click();
    await page.waitForTimeout(3200);
  }
  await page.addStyleTag({ content: PATCH });
  await capture(page, "08-assistant", "修業問答：決定／不確定／超出範圍三種回答");

  await go(page, "/scenario");
  await capture(page, "09-scenario", "情境試算：七個情境分四組");

  // 額外修業目標只出現在有註冊輔系／雙主修／學程的案例 ——
  // demo 是一般生，正確地什麼都不顯示，所以換一個案例拍
  await go(page, "/", "minor-student");
  await capture(page, "18-extra-goals-home", "額外修業目標（輔系與學程學生）：首頁的分段進度");
  await go(page, "/audit", "minor-student");
  await capture(page, "19-extra-goals-audit", "額外修業目標：逐項應修／已修／未修與尚缺科目");

  await go(page, "/syllabus/IM4021");
  await capture(page, "10-syllabus", "課綱：系統手上的欄位與原始檔下載");

  await go(page, "/sources");
  await capture(page, "11-sources", "原文出處：所有被引用的條文集中一頁");

  await go(page, "/profile");
  await capture(page, "12-profile", "個人資料與選課傾向（依類別收合）");

  await go(page, "/privacy");
  await capture(page, "13-privacy", "資料與隱私：查閱、只刪選填、全部刪除、匯出");

  await go(page, "/rulepack");
  await capture(page, "14-rulepack", "適用規劃表：目前版本與上傳");

  await go(page, "/trace");
  await capture(page, "15-trace", "執行紀錄：10 個步驟、工具調用、耗時");

  await go(page, "/about");
  await capture(page, "16-about", "資料來源與免責聲明");

  await page.goto(`${BASE}/review`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: PATCH });
  await capture(page, "17-review", "規則包人工校對（內部作業頁）");

  await ctx.close();
}

// ------------------------------------------------------------ 手機
console.log("手機 390px");
{
  const ctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  await go(page, "/");
  await capture(page, "20-m-home", "手機：首頁");

  await page.goto(BASE + "/" + Q, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "開啟選單" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, "21-m-drawer.png") });
  shots.push({ file: "21-m-drawer.png", title: "手機：側邊抽屜導覽" });
  console.log("  21-m-drawer.png");

  await go(page, "/audit");
  await capture(page, "22-m-audit", "手機：修業明細（表格轉區塊）");

  await go(page, "/plan");
  await capture(page, "23-m-plan", "手機：選課建議（週末無課時收掉六日，不需橫捲）");

  await go(page, "/holds");
  await capture(page, "24-m-holds", "手機：待確認事項");

  await go(page, "/assistant");
  await capture(page, "25-m-assistant", "手機：修業問答");

  await ctx.close();
}

await browser.close();

// ------------------------------------------------------------ 索引
const index = [
  "# Aidit 系統截圖",
  "",
  `擷取時間：${new Date().toISOString()}`,
  `資料來源：評測案例 \`${FIXTURE}\`，學期 \`${TERM}\`（合成資料，非真實學生）。`,
  "額外修業目標那兩張改用 `minor-student` —— 一般生本來就沒有輔系／雙主修／學程。",
  "",
  "本資料夾由 `node scripts/screenshots.mjs` 產生，介面改動後重跑即可更新。",
  "",
  "## 一併留存的文件",
  "",
  "- [SPEC-CHANGES.md](../SPEC-CHANGES.md) —— 規格異動與實作偏差紀錄（快照）",
  "",
  "## 桌機（1280px）",
  "",
  ...shots
    .filter((s) => !/^2\d-m-/.test(s.file))
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((s) => `- [${s.title}](${s.file})`),
  "",
  "## 手機（390px）",
  "",
  ...shots
    .filter((s) => /^2\d-m-/.test(s.file))
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((s) => `- [${s.title}](${s.file})`),
  "",
].join("\n");
writeFileSync(join(OUT, "README.md"), index, "utf8");

// 規格異動紀錄一併留存。標明它是快照 —— 否則之後會有人改到副本
{
  const src = join(process.cwd(), "docs/SPEC-CHANGES.md");
  const dst = join(OUT, "SPEC-CHANGES.md");
  copyFileSync(src, dst);
  const body = readFileSync(dst, "utf8");
  writeFileSync(
    dst,
    [
      "> **這是快照，不是正本。**",
      "> 正本在 `docs/SPEC-CHANGES.md`；本檔隨截圖一併留存，",
      `> 擷取於 ${new Date().toISOString().slice(0, 10)}。`,
      "> 要修改請改正本，再重跑 `npm run shots` 更新這份副本。",
      "",
      body,
    ].join("\n"),
    "utf8",
  );
  console.log("  SPEC-CHANGES.md（快照）");
}

console.log(`\n完成：${shots.length} 張，輸出於 docs/screenshots/`);
