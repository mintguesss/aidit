/**
 * 課表微調的換說法與多輪測試集：接真的模型，檢查最後空出的星期。
 *
 *   node scripts/plan-paraphrase.mjs http://localhost:3000 2   # 本機，每案 2 次
 *   node scripts/plan-paraphrase.mjs https://aidit-weld.vercel.app 1
 *
 * 2026-11-09 試用：「一到四排滿」被做成空出一、四，多輪後疊成五天全空。改成模型看目前條件、
 * 給完整的空出星期之後，本機 60/60 通過。改到對話排課時要重跑。60 次約 US$0.035。
 */
const B = process.argv[2] ?? "http://localhost:3000";
const RUNS = Number(process.argv[3] ?? 2);
const fixture = "school-a-im-111-b-year2";

// [說法, 前幾輪已空出, 期望最後空出（null＝只要不是五天全空、不出錯即可，只記錄）, 前一輪對話（選填）]
const CASES = [
  ["星期五不要排課", [], [5]],
  ["禮拜五空下來", [], [5]],
  ["週五不想上課", [], [5]],
  ["五不想去學校", [], [5]],
  ["週五留給打工", [], [5]],
  ["我禮拜五要回家", [], [5]],
  ["星期五放假", [], [5]],
  ["一到四上課就好，五要回家", [], [5]],
  ["禮拜一到禮拜四的課排滿", [], [5]],
  ["星期一到星期四課排滿", [], [5]],
  ["課只排週一至四", [], [5]],
  ["可以把課塞在前四天嗎", [], [5]],
  ["把課集中在週一到週四", [], [5]],
  ["週五不要有課", [], [5]],
  ["星期五整天都不要排", [], [5]],
  ["禮拜五想休息", [], [5]],
  ["不要排週五", [], [5]],
  ["我週五沒空", [], [5]],
  ["週五要實習不能上課", [], [5]],
  ["把星期五的課拿掉", [], [5]],
  // 多輪：前幾輪留下的條件
  ["一到四排滿", [1, 4], [5]],
  ["星期一到星期四課排滿", [1, 2, 3, 4], [5]],
  ["星期三也不要", [5], [3, 5], ["星期五不要排課", "已空出星期五。"]],
  ["星期五可以排了", [5], []],
  ["還是星期五可以有課好了", [5], []],
  ["星期三可以排", [3, 5], [5]],
  ["不要早上的課", [5], [5]],
  ["多一堂課", [5], [5]],
  ["星期三的課可以換一門嗎", [], null],
  ["我想週休三日", [], null],
];

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
let pass = 0, total = 0, cost = 0;
const fails = [];
for (const [said, prior, want, history] of CASES) {
  for (let run = 0; run < RUNS; run++) {
    const messages = history ? [{ role: "user", content: history[0] }, { role: "assistant", content: history[1] }, { role: "user", content: said }] : [{ role: "user", content: said }];
    const res = await fetch(`${B}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, scope: "plan", fixture, constraints: { avoidDays: prior } }),
    });
    const d = await res.json();
    cost += d.llm?.costUsd ?? 0;
    const all = d.plan?.constraints?.avoidDays;
    // 週末本來就幾乎沒課，模型多空出六、日不影響結果；比對只看平日
    const got = all?.filter((x) => x <= 5);
    const asked = d.clarifying === true;
    const shown = all ? `[${all}]` : asked ? `問：${d.reply?.headline}` : `（${res.status} ${d.reply?.headline ?? d.error ?? ""}）`;
    const allFive = got && [1, 2, 3, 4, 5].every((x) => got.includes(x));
    const ok = want === null ? !allFive && res.ok : got !== undefined && same([...got].sort(), want);
    total++;
    if (ok) pass++;
    else fails.push(`${said}（前 [${prior}]）→ ${shown}，期望 ${want === null ? "不是五天全空" : `[${want}]`}`);
    console.log(`${ok ? "✓" : "✗"} ${said}（前 [${prior}]）#${run + 1} → ${shown}　模型 ${d.llm?.calls ?? 0} 次`);
  }
}
console.log(`\n通過 ${pass}/${total}，模型費用約 US$${cost.toFixed(4)}`);
if (fails.length) console.log("未通過：\n" + fails.join("\n"));
if (pass < total) process.exitCode = 1;
