/**
 * 版面檢查（手機／桌機）。
 *
 * 用系統已安裝的 Edge 驅動 playwright-core，不額外下載瀏覽器。
 * 檢查兩件用眼睛看很容易漏掉的事：
 *   1. 任一斷點都不得出現橫向捲動（手機破版最常見的成因）
 *   2. 每一頁都有頂條（品牌與主導覽）
 *
 * 用法：
 *   npm run dev            （另一個視窗）
 *   npm run ui:check       （加 --shots 會一併輸出截圖）
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.UI_BASE ?? "http://localhost:3000";
const PAGES = [
  "/", "/audit", "/holds", "/plan", "/assistant", "/scenario",
  "/trace", "/profile", "/rulepack", "/syllabus/IM4021", "/sources", "/about", "/privacy",
];
const WIDTHS = [360, 390, 720, 940, 1280];
const WANT_SHOTS = process.argv.includes("--shots");
const SHOT_DIR = process.argv[process.argv.indexOf("--shots") + 1] ?? ".data/shots";

const browser = await chromium.launch({ channel: "msedge", headless: true }).catch((e) => {
  console.error("無法啟動 Edge：", e.message);
  console.error("本檢查需要系統已安裝 Microsoft Edge。");
  process.exit(2);
});

const failures = [];

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });

    const r = await page.evaluate(() => {
      const de = document.documentElement;
      // 寬內容（課表、資料表）允許在自己的 overflow-x 容器裡橫捲 —— 只要容器本身沒破版。
      // 真正要抓的是「把整頁撐破」的元素。
      const inScroller = (el) => {
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const ov = getComputedStyle(n).overflowX;
          if (ov === "auto" || ov === "scroll") {
            return n.getBoundingClientRect().right <= de.clientWidth + 1;
          }
        }
        return false;
      };
      const culprits = [];
      for (const el of document.querySelectorAll("body *")) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.right <= de.clientWidth + 1) continue;
        if (el.closest(".topnav")) continue;
        if (el.closest("thead")) continue;
        if (inScroller(el)) continue;
        culprits.push(
          `<${el.tagName.toLowerCase()} class="${(typeof el.className === "string" ? el.className : "").slice(0, 30)}"> right=${Math.round(b.right)}`,
        );
      }
      const bar = document.querySelector(".topbar-in");
      return {
        scrollW: de.scrollWidth,
        clientW: de.clientWidth,
        culprits: culprits.slice(0, 3),
        hasIdBar: Boolean(bar && bar.getBoundingClientRect().height > 0),
      };
    });

    const tag = `${String(width).padStart(4)}px ${path}`;
    if (r.scrollW > r.clientW) {
      failures.push(`${tag}：橫向溢出 ${r.scrollW} > ${r.clientW}　${r.culprits.join(" / ")}`);
    }
    if (r.culprits.length > 0) {
      failures.push(`${tag}：有元素超出畫面　${r.culprits.join(" / ")}`);
    }
    if (!r.hasIdBar) failures.push(`${tag}：缺少頂條`);

    if (WANT_SHOTS && (width === 390 || width === 1280)) {
      mkdirSync(SHOT_DIR, { recursive: true });
      const name = path === "/" ? "overview" : path.slice(1);
      await page.screenshot({
        path: `${SHOT_DIR}/${width === 390 ? "m" : "d"}-${name}.png`,
        fullPage: true,
      });
    }
  }
  await page.close();
  console.log(`${String(width).padStart(4)}px　檢查完成`);
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n版面檢查失敗（${failures.length} 項）：`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`\n版面檢查通過：${PAGES.length} 個頁面 × ${WIDTHS.length} 個寬度，無橫向溢出。`);
if (WANT_SHOTS) console.log(`截圖已輸出至 ${SHOT_DIR}`);
