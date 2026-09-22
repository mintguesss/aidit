import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const chat = async (page, texts) => {
  for (const t of texts) {
    await page.fill(".chat-form input", t);
    await page.click('.chat-form button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector(".turn-body.pending"), { timeout: 20000 });
    await page.waitForTimeout(250);
  }
};
const shoot = async (name, url, vp, act) => {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: "networkidle" });
  if (act) await act(page);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  await page.close();
  console.log("→", name);
};
const M = { width: 390, height: 844 }, D = { width: 1280, height: 900 }, B = "http://localhost:3000";
await shoot("d-plan", B + "/plan", D, (p) => chat(p, ["空出星期五", "為什麼沒有企業流程管理？"]));
await shoot("d-ask", B + "/assistant", D, (p) => chat(p, ["超修可以流用嗎？", "抵免要怎麼申請？", "老師給分甜不甜？"]));
await shoot("m-ask", B + "/assistant", M, (p) => chat(p, ["我還差多少學分？"]));
await browser.close();
