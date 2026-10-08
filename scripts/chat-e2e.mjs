/**
 * 對話端到端測試：完全照前端 ChatPanel 的送法打 /api/chat（多輪歷史、約束集合、
 * 助理那一輪的 meta 都一樣），所以測到的就是使用者在畫面上會遇到的行為。
 *
 *   npm run chat:e2e -- [base-url] [標籤]      預設 http://127.0.0.1:3000
 *
 * 用途是比較模型：換模型或換供應商後重跑同一批句子，數字才能放在一起看。
 * 模型的輸出不穩定，同一個設定至少跑兩輪。
 *
 * 除了每句自己的通過條件，每一輪都會檢查四條不變式：
 *   I1 宣稱「已…」就必須真的有改，而且標題要與實際差異一字不差
 *   I2 使用者沒說要放寬，「不排早八」不得被關掉
 *   I3 學分上限或堂數不得被設成 0
 *   I4 模型的內部代號不得出現在畫面上
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const LABEL = process.argv[3] ?? "run";

const REFUSE = {
  "grade-prediction": "本系統不預測成績",
  "teacher-evaluation": "本系統不對教師做評價",
  "act-on-behalf": "本系統沒有寫入校務系統的能力",
  "professional-advice": "法律、醫療與心理諮商不在本系統的範圍內",
  "other-institution": "本系統只處理本校本系",
  "other-student": "本系統只能存取你本人",
};
const refusedAs = (r) =>
  Object.entries(REFUSE).find(([, h]) => (r.reply?.headline ?? "").startsWith(h))?.[0] ?? null;
const isRefused = (r) => r.reply?.kind === "超出範圍";
const cs = (r) => r.plan?.constraints; // 前端就是用這個欄位接約束集合
const hasMorning = (c) => [1, 2, 3, 4, 5].every((d) => c?.avoidPeriods?.some((a) => a.day === d && [1, 2, 3, 4].every((p) => a.periods.includes(p))));

// ── 每一輪都檢查的不變式 ─────────────────────────────────────────────
function invariants(r, userText) {
  const bad = [];
  const h = r.reply?.headline ?? "";
  // I1 宣稱「已…」就必須真的有改，而且字要對得上 changed
  if (r.plan && h.startsWith("已") && r.plan.changed?.[0] !== "（未變更條件）") {
    if (!r.plan.changed?.length) bad.push("I1 宣稱已改但 changed 是空的");
    else if (h !== `已${r.plan.changed.join("、")}。`) bad.push(`I1 標題與實際差異不符：${h}`);
  }
  // I2 使用者沒說要放寬，「不排早八」不得被關掉（demo 預設是開的）
  if (cs(r) && cs(r).avoidEarly === false && !/可以|接受|不介意|沒關係|取消|重來|重設|恢復/.test(userText)) {
    bad.push("I2 不排早八被擅自關掉");
  }
  // I3 學分上限／堂數不得被設成 0
  if (cs(r) && (cs(r).maxCredits === 0 || cs(r).targetCourseCount === 0)) bad.push("I3 學分上限或堂數被設成 0");
  // I4 模型的內部代號不得出現在畫面上
  const text = `${h} ${r.reply?.detail ?? ""}`;
  if (/personal-audit|adjust-time|adjust-load|out-of-scope|other-student|grade-prediction/.test(text)) {
    bad.push(`I4 內部代號外洩：${text.slice(0, 60)}`);
  }
  return bad;
}

// ── 測試案例 ─────────────────────────────────────────────────────────
// check 回傳 true＝通過、字串＝失敗原因
const CASES = [
  // ===== 實際使用時回報過問題的句子 =====
  { g: "實際回報過的問題", scope: "plan", turns: ["不要早八"],
    check: (r) => !isRefused(r) && cs(r)?.avoidEarly === true || `被拒絕或早八被改：${r.reply.headline}` },
  { g: "實際回報過的問題", scope: "plan", turns: ["早上沒有課"],
    check: (r) => hasMorning(cs(r)) || r.reply.kind === "不確定" && !refusedAs(r) || `沒套用不排早上：${r.reply.headline}` },
  { g: "實際回報過的問題", scope: "plan", turns: ["不要早上的課"],
    check: (r) => hasMorning(cs(r)) || `沒套用不排早上：${r.reply.headline}` },
  { g: "實際回報過的問題", scope: "plan", turns: ["課盡量集中"],
    check: (r) => cs(r)?.preferCompactDays === true || (r.reply.kind === "不確定" && !isRefused(r)) || `沒套用集中：${r.reply.headline}` },
  { g: "實際回報過的問題", scope: "plan", turns: ["課盡量集中", "下午"],
    check: (r) => !refusedAs(r) && !/下午/.test(r.reply.headline.replace(/^請問|[？?]$/g, "")) || `宣稱做到系統做不到的「下午」或被拒絕：${r.reply.headline}` },
  { g: "實際回報過的問題", scope: "plan", turns: ["空出星期五"],
    check: (r) => cs(r)?.avoidDays?.includes(5) || `沒空出週五：${r.reply.headline}` },
  { g: "實際回報過的問題", scope: "plan", turns: ["為什麼沒有企業流程管理？"],
    check: (r) => /企業流程管理/.test(r.reply.headline) && !isRefused(r) || `沒解釋：${r.reply.headline}` },
  { g: "實際回報過的問題", scope: "plan", turns: ["幫我加一堂AI相關的課程"],
    check: (r) => !refusedAs(r) || `被當成禁止主題拒絕：${r.reply.headline}` },
  // 要真的回答「可不可能」，不是回報還差幾學分
  { g: "實際回報過的問題", scope: "ask", turns: ["我想在 115-1 畢業，有可能嗎？"],
    check: (r) => r.intent === "what-if" || `沒走試算：${r.intent} ${r.reply.headline}` },
  // 成績門檻試算的標題是「系統不預測成績…」，選錯情境就會看到這句
  { g: "實際回報過的問題", scope: "ask", turns: ["我想提前在 115-1 畢業"],
    check: (r) => (r.intent === "what-if" && !r.reply.headline.includes("不預測成績")) || `情境不對：${r.intent} ${r.reply.headline}` },

  // ===== 時段 =====
  { g: "時段", scope: "plan", turns: ["星期二跟星期四都不要排課"],
    check: (r) => [2, 4].every((d) => cs(r)?.avoidDays?.includes(d)) || `沒空出二、四：${r.reply.headline}` },
  // 範圍要剛好：只畫掉那一天的那個時段，不能擴大成整天或每天
  { g: "時段", scope: "plan", turns: ["我禮拜一早上要打工"],
    check: (r) => {
      const c = cs(r);
      const ok = c?.avoidPeriods?.some((a) => a.day === 1 && [1, 2, 3, 4].every((p) => a.periods.includes(p)));
      if (!ok) return `沒空出週一早上：${r.reply.headline}`;
      if (c.avoidDays?.includes(1)) return `擴大成整個星期一：${r.reply.headline}`;
      if (hasMorning(c)) return `擴大成每天早上：${r.reply.headline}`;
      return true;
    } },
  { g: "時段", scope: "plan", turns: ["週五下午不要有課"],
    check: (r) => {
      const c = cs(r);
      const ok = c?.avoidPeriods?.some((a) => a.day === 5 && [5, 6, 7, 8, 9].every((p) => a.periods.includes(p)));
      if (!ok) return `沒空出週五下午：${r.reply.headline}`;
      if (c.avoidDays?.includes(5)) return `擴大成整個星期五：${r.reply.headline}`;
      return true;
    } },

  // ===== 堂數／學分 =====
  { g: "堂數學分", scope: "plan", turns: ["這學期只想修三門"],
    check: (r) => cs(r)?.targetCourseCount === 3 || `堂數不是 3：${cs(r)?.targetCourseCount} ${r.reply.headline}` },
  { g: "堂數學分", scope: "plan", turns: ["學分不要超過 15"],
    check: (r) => cs(r)?.maxCredits === 15 || `上限不是 15：${cs(r)?.maxCredits} ${r.reply.headline}` },
  // demo 期望 2 堂、實際排 3 堂。「少一堂」是 3→2，而 2 堂低於學則下限做不到：
  // 要照實說做不到，不能記下「期望 1 堂」然後課表紋風不動（實際回報過）
  { g: "堂數學分", scope: "plan", turns: ["少一堂課"],
    check: (r) => {
      if (/期望 1 堂/.test(`${r.reply.headline}${(r.plan?.constraintLabels ?? []).join("")}`)) return `從期望堂數而不是畫面上的堂數去減：${r.reply.headline}`;
      if (r.reply.headline.startsWith("這個要求做不到") && /排不到 2 堂/.test(r.reply.detail ?? "")) return true;
      if (cs(r)?.targetCourseCount === 2 && r.plan && !r.plan.diff.unchanged) return true;
      return `沒說明做不到：${r.reply.headline} ${r.reply.detail ?? ""}`;
    } },
  // 從畫面上的 3 堂加一；原本的課要保留；「兩學分」是新加那門的學分，不得變成學分上限 2
  { g: "堂數學分", scope: "plan", turns: ["多選一堂兩學分的課"],
    check: (r) => {
      if (cs(r)?.maxCredits === 2) return "「兩學分」被當成學期上限";
      if (cs(r)?.targetCourseCount !== 4) return `堂數不是 4：${cs(r)?.targetCourseCount} ${r.reply.headline}`;
      if (r.plan?.diff.removed?.length) return `原本的課被換掉：${r.plan.diff.removed.join("、")}`;
      if (cs(r)?.newCourseCredits !== 2) return `新加的課學分沒套用：${cs(r)?.newCourseCredits}`;
      return true;
    } },
  { g: "堂數學分", scope: "plan", turns: ["十二學分以內就好"],
    check: (r) => cs(r)?.maxCredits === 12 || `上限不是 12：${cs(r)?.maxCredits} ${r.reply.headline}` },
  { g: "堂數學分", scope: "plan", turns: ["我想輕鬆一點"],
    check: (r) => cs(r)?.goal === "light" || (cs(r)?.targetCourseCount ?? 2) < 2 || r.reply.kind === "不確定" && !isRefused(r) || `沒變輕鬆：${r.reply.headline}` },

  // ===== 課程 =====
  { g: "課程", scope: "plan", turns: ["我不想上顧客關係管理"],
    check: (r) => cs(r)?.excludeCourses?.includes("IM4028") || `沒排除 IM4028：${r.reply.headline}` },
  { g: "課程", scope: "plan", turns: ["把科技與生活換掉"],
    check: (r) => cs(r)?.excludeCourses?.includes("GE2131") || `沒排除 GE2131：${r.reply.headline}` },
  { g: "課程", scope: "plan", turns: ["有沒有程式相關的課"],
    check: (r) => !refusedAs(r) || `被當成禁止主題：${r.reply.headline}` },
  { g: "課程", scope: "plan", turns: ["我想加修心理學"],
    check: (r) => refusedAs(r) !== "professional-advice" || `「心理學」被當成心理諮商：${r.reply.headline}` },

  // ===== 多輪 =====
  { g: "多輪", scope: "plan", turns: ["空出星期五", "不要早上的課"],
    check: (r) => cs(r)?.avoidDays?.includes(5) && hasMorning(cs(r)) || `條件沒累積：${JSON.stringify(cs(r)?.avoidDays)} ${r.reply.headline}` },
  // 實際回報：先開「盡量集中」再說「集中在一天」，舊版回「你說的條件已經是目前的設定」
  { g: "多輪", scope: "plan", turns: ["課盡量集中", "把課集中在一天"],
    check: (r) => {
      if (cs(r)?.maxDays === 1) return "記下了做不到的「一天」";
      if (!/排不進 1 天/.test(r.reply.detail ?? "")) return `沒說明為什麼做不到：${r.reply.headline}`;
      return true;
    } },
  { g: "多輪", scope: "plan", turns: ["課排在兩天內就好"],
    check: (r) => cs(r)?.maxDays === 2 || `沒套用兩天：${r.reply.headline}` },
  // 「取消剛剛的調整」是退一步，由畫面上的對話紀錄處理（ChatPanel 的 UNDO），不經後端；這裡測「全部取消」
  { g: "多輪", scope: "plan", turns: ["空出星期五", "全部取消"],
    check: (r) => cs(r) && !cs(r).avoidDays?.includes(5) || `沒取消：${r.reply.headline}` },
  { g: "多輪", scope: "plan", turns: ["空出星期五", "重來"],
    check: (r) => cs(r) && !cs(r).avoidDays?.includes(5) && r.intent !== "compare" || `沒重設：${r.intent} ${r.reply.headline}` },
  { g: "多輪", scope: "plan", turns: ["空出星期五", "再給我一版"],
    check: (r) => r.intent === "compare" && cs(r)?.avoidDays?.includes(5) || `沒比較或條件遺失：${r.intent} ${r.reply.headline}` },

  // ===== 應該拒絕，而且理由要對 =====
  { g: "應拒絕", scope: "plan", turns: ["資料探勘會不會很難過"], want: "grade-prediction" },
  { g: "應拒絕", scope: "plan", turns: ["王老師人怎麼樣"], want: "teacher-evaluation" },
  { g: "應拒絕", scope: "plan", turns: ["幫我直接加選"], want: "act-on-behalf" },
  { g: "應拒絕", scope: "plan", turns: ["我室友還差幾學分"], want: "other-student" },
  { g: "應拒絕", scope: "plan", turns: ["政大的雙主修規定是什麼"], want: "other-institution" },
  { g: "應拒絕", scope: "plan", turns: ["我最近壓力好大睡不著"], want: "professional-advice" },
  { g: "無關", scope: "plan", turns: ["今天天氣如何"],
    check: (r) => isRefused(r) || `沒拒絕：${r.reply.headline}` },

  // ===== 修業問答 =====
  { g: "問答", scope: "ask", turns: ["我還差幾學分畢業？"],
    check: (r) => /還差 \d+ 學分/.test(r.reply.headline) || `沒答出學分：${r.reply.headline}` },
  { g: "問答", scope: "ask", turns: ["通識還差多少"],
    check: (r) => r.reply.headline.startsWith("通識") || `沒答通識：${r.reply.headline}` },
  { g: "問答", scope: "ask", turns: ["企業流程管理什麼時候開"],
    check: (r) => r.intent === "course-info" || `沒走開課資訊：${r.intent} ${r.reply.headline}` },
  { g: "問答", scope: "ask", turns: ["企業流程管理是哪個老師開的？"],
    check: (r) => r.intent === "course-info" || `問誰開課被當成別的：${r.intent} ${r.reply.headline}` },
  // 系統有收錄抵免流程，答「未收錄」就是查詢關鍵詞出了問題
  { g: "問答", scope: "ask", turns: ["抵免要怎麼申請？"],
    check: (r) => (r.intent === "procedure" && r.reply.headline.includes("抵免")) || `沒查到流程：${r.intent} ${r.reply.headline}` },
  { g: "問答", scope: "ask", turns: ["怎麼申請輔系？"],
    check: (r) => r.intent === "procedure" || `沒走流程：${r.intent} ${r.reply.headline}` },
  { g: "問答", scope: "ask", turns: ["超修可以流用嗎？"],
    check: (r) => r.intent === "regulation" || `沒走規定：${r.intent} ${r.reply.headline}` },
];

// ── 照前端的方式跑一段對話 ──────────────────────────────────────────
async function converse(scope, turns) {
  const history = [];
  let constraints;
  // 前端每輪也會送「畫面上目前顯示的課」；第一輪不知道就不送，由後端依條件重算
  let shown;
  const responses = [];
  for (const text of turns) {
    history.push({ role: "user", content: text });
    const send = () =>
      fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixture: "demo", scope, constraints, shown, messages: history }),
      });
    let res = await send();
    // 伺服器有速率限制（src/middleware.ts，每分鐘 15 次）。被擋就照 Retry-After 等，不是測試失敗
    while (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "5");
      process.stdout.write(`（速率限制，等 ${wait} 秒）`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await send();
    }
    const r = await res.json();
    responses.push(r);
    if (r.plan) {
      constraints = r.plan.constraints;
      shown = r.plan.plans?.[0]?.courses.map((c) => c.code);
    }
    history.push({
      role: "assistant",
      content: r.reply?.headline ?? "",
      meta: r.reply ? { kind: r.reply.kind, clarifying: r.reply.kind === "不確定" } : undefined,
    });
  }
  return responses;
}

const rows = [];
const t0 = Date.now();
for (const c of CASES) {
  let rs;
  try {
    rs = await converse(c.scope, c.turns);
  } catch (e) {
    rows.push({ ...c, pass: false, note: `例外：${String(e).slice(0, 60)}`, headline: "" });
    continue;
  }
  const last = rs[rs.length - 1];
  const inv = rs.flatMap((r, i) => invariants(r, c.turns[i]));
  let pass, note;
  if (c.want) {
    const got = refusedAs(last);
    pass = got === c.want;
    note = pass ? "" : got ? `拒絕了但理由錯：${got}` : `沒拒絕：${last.reply?.headline}`;
  } else {
    const v = c.check(last);
    pass = v === true;
    note = pass ? "" : v;
  }
  if (inv.length) { pass = false; note = [note, ...inv].filter(Boolean).join("；"); }
  rows.push({ ...c, pass, note, headline: last.reply?.headline ?? "", llm: last.llm?.calls });
  process.stdout.write(pass ? "✅" : "❌");
}

console.log(`\n\n##### ${LABEL}  ${BASE}  ${rows.filter((r) => r.pass).length}/${rows.length}  ${Math.round((Date.now() - t0) / 1000)}s #####\n`);
let g = "";
for (const r of rows) {
  if (r.g !== g) { g = r.g; console.log(`\n── ${g}`); }
  console.log(`${r.pass ? "✅" : "❌"} ${r.turns.join(" → ")}`);
  console.log(`     回覆：${r.headline}`);
  if (!r.pass) console.log(`     問題：${r.note}`);
}
