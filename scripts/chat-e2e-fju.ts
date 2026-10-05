// 真實資料（輔大）對話測試：標準答案由引擎與開課資料獨立算出，再打 HTTP API 比對。
// 輔大規則包只在 Supabase，所以伺服器與這支腳本都要讀得到 .env 裡的 SUPABASE_*。
// 用法：npx tsx scripts/chat-e2e-fju.ts <base-url> <標籤>
//   離線規則：另開一個設 AIDIT_LLM_PROVIDER=anthropic、AIDIT_LLM_MODEL=claude-opus-5 而沒有金鑰的實例來打（走規則、不吃顯卡）
import "@/lib/util/env";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { fixture } from "@/lib/providers/fixtures";
import { offeringsFor } from "@/lib/offerings";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const LABEL = process.argv[3] ?? "run";

type R = any;
const norm = (s: string) => s.replace(/[-－](英|網)$/, "").replace(/\s/g, "").toLowerCase();

async function chat(fx: string, scope: "plan" | "ask", turns: string[]): Promise<R[]> {
  const history: any[] = [];
  let constraints: any;
  let shown: string[] | undefined;
  const out: R[] = [];
  for (const t of turns) {
    history.push({ role: "user", content: t });
    let r: R;
    // 照速率限制走（每分鐘 15 次）：被擋就等 Retry-After 再送，不繞過
    for (;;) {
      const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixture: fx, scope, constraints, shown, messages: history }),
      });
      if (res.status === 429) {
        await new Promise((ok) => setTimeout(ok, (Number(res.headers.get("retry-after")) || 10) * 1000 + 500));
        continue;
      }
      r = await res.json();
      break;
    }
    out.push(r);
    if (r.plan) {
      constraints = r.plan.constraints;
      shown = r.plan.plans?.[0]?.courses.map((c: any) => c.code);
    }
    history.push({ role: "assistant", content: r.reply?.headline ?? "", meta: r.reply ? { kind: r.reply.kind, clarifying: r.reply.kind === "不確定" } : undefined });
  }
  return out;
}

const rows: { fx: string; g: string; q: string; pass: boolean; got: string; note: string }[] = [];
const text = (r: R) => `${r.reply?.headline ?? ""}｜${(r.reply?.detail ?? "").replace(/\n/g, " ⏎ ")}`;
function record(fx: string, g: string, q: string, r: R, v: true | string) {
  rows.push({ fx, g, q, pass: v === true, got: text(r), note: v === true ? "" : v });
  process.stdout.write(v === true ? "✅" : "❌");
}

for (const fx of ["fju-im-111-year2", "fju-im-111-year3", "fju-im-111-year1"]) {
  // ── 標準答案：引擎與開課資料 ──
  const { fixture: f, term } = parsePageParams({ fixture: fx });
  const s = await getAuditSession(f, term);
  if (!s.outcome.ok) throw new Error(`${fx} 審查失敗：${s.outcome.error.reason}`);
  const audit = s.outcome.audit;
  const gtPlan = s.outcome.state.plans[0];
  const rec = fixture(f).record;
  const [y, t] = audit.nextTerm.split("-").map(Number) as [number, 1 | 2];
  const offerings = offeringsFor(y, t, "fju");
  const byCode = new Map(offerings.map((o) => [o.code, o]));
  const passedCodes = new Set(rec.courses.filter((c) => c.status === "passed").map((c) => c.code));
  const passedNames = new Set(rec.courses.filter((c) => c.status === "passed" && !c.yearLong).map((c) => norm(c.name)));
  const cat = (name: string) => audit.categories.find((c) => c.name.includes(name))!;

  /** 任何一份課表都要通過的檢查 */
  function planValid(r: R, opts: { avoidDays?: number[]; maxCredits?: number; noMorning?: boolean } = {}): true | string {
    const p = r.plan?.plans?.[0];
    if (!p) return r.reply?.kind === "決定" ? "回『決定』卻沒有課表" : true; // 無解或做不到時沒有課表是合理的
    for (const c of p.courses) {
      const o = byCode.get(c.code);
      if (!o) return `${c.name}（${c.code}）不在 ${audit.nextTerm} 開課資料`;
      if (passedCodes.has(c.code) && !rec.courses.find((x) => x.code === c.code)?.yearLong) return `${c.name} 已經修過（課號相同）`;
      if (passedNames.has(norm(c.name))) return `${c.name} 已經修過（課名相同）`;
      if (opts.avoidDays && c.slots?.some((sl: any) => opts.avoidDays!.includes(sl.day))) return `${c.name} 落在要空出的星期`;
      if (opts.noMorning && c.slots?.some((sl: any) => sl.periods.some((x: number) => x <= 4))) return `${c.name} 排在早上（${o.rawSlotText}）`;
    }
    const all = p.courses.flatMap((c: any) => (c.slots ?? []).map((sl: any) => ({ c: c.name, ...sl })));
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.c !== b.c && a.day === b.day && a.periods.some((x: number) => b.periods.includes(x))) return `衝堂：${a.c} × ${b.c}`;
    }
    if (opts.maxCredits !== undefined && p.totalCredits > opts.maxCredits) return `共 ${p.totalCredits} 學分，超過 ${opts.maxCredits}`;
    return true;
  }

  // ── 修業問答 ──
  {
    const [r] = await chat(fx, "ask", ["我還差幾學分畢業？"]);
    const want = `還差 ${audit.unmet} 學分`;
    const bad = audit.categories.filter((c) => c.unmet > 0 && !r.reply.headline.includes(`${c.name} ${c.unmet}`));
    record(fx, "問答", "我還差幾學分畢業？", r,
      audit.unmet === 0 ? (/已|滿足|0/.test(r.reply.headline) || `應已修畢：${r.reply.headline}`) :
      !r.reply.headline.includes(want) ? `應含「${want}」` : bad.length ? `類別數字不符：${bad.map((c) => `${c.name} ${c.unmet}`).join("、")}` : true);
  }
  for (const [q, name] of [["通識還差多少？", "通識涵養課程"], ["院系必修還差多少？", "院系必修課程"], ["系專選還差多少學分？", "本系專業選修"]] as const) {
    const [r] = await chat(fx, "ask", [q]);
    const c = cat(name);
    const ok = r.reply.headline.startsWith(name) && (c.unmet > 0 ? r.reply.headline.includes(`還差 ${c.unmet} 學分`) : /已滿足|已足/.test(r.reply.headline));
    record(fx, "問答", q, r, ok || `標準答案：${name} 未修 ${c.unmet}`);
  }
  {
    // 通識缺領域時，回答必須講出缺哪個領域 —— 只說「還差 N 學分」會讓學生隨便修 N 學分的通識
    const ge = cat("通識涵養課程");
    const miss = ge.subRules.find((x) => x.status === "unmet");
    const [r] = await chat(fx, "ask", ["通識還差多少？"]);
    if (miss) {
      const domains = (miss.detail.match(/尚缺 (.+?) 領域/)?.[1] ?? "").split("、").filter(Boolean);
      const said = domains.every((d) => text(r).includes(d));
      record(fx, "問答", "通識還差多少？（是否講出缺的領域）", r, said || `缺 ${domains.join("、")} 領域，回答沒提到`);
    }
  }
  {
    const [r] = await chat(fx, "ask", ["畢業總共要修幾學分？"]);
    const total = audit.categories.reduce((a, c) => a + c.required, 0);
    record(fx, "問答", "畢業總共要修幾學分？", r, text(r).includes(String(total)) || `標準答案：各類別合計 ${total}`);
  }
  // 開課資訊：拿推薦課表裡的課，時間、老師、名額要跟開課資料一致
  for (const c of (gtPlan?.courses ?? []).filter((x) => byCode.get(x.code)?.rawSlotText).slice(0, 3)) {
    const o = byCode.get(c.code)!;
    const [r] = await chat(fx, "ask", [`${o.name}什麼時候上課？`]);
    const t = text(r);
    // 回覆把連續節次寫成區間（D7-E0），所以比對星期、第一節與最後一節，且要在同一個班的那一行
    const toks = o.rawSlotText!.split(/[ ,\/]+/).filter(Boolean);
    const pers = toks.filter((x: string) => /^[A-Z]/.test(x));
    // 班太多只列前 8 個時，目標那一班可能不在列，改成檢查學期對不對
    const slotOk = /只列前/.test(t) ? t.includes(`${audit.nextTerm} 開`) : t.split(/\n|⏎/).some((line) => line.includes(`${toks[0]} ${pers[0]}`) && line.includes(pers.at(-1)!) && (!o.teacher || line.includes(o.teacher)));
    const teacherOk = !o.teacher || t.includes(o.teacher);
    record(fx, "開課", `${o.name}什麼時候上課？`, r,
      r.intent !== "course-info" ? `沒走開課資訊：${r.intent}` : !slotOk ? `時段應為「${o.rawSlotText}」` : !teacherOk ? `老師應為「${o.teacher}」` : true);
  }

  // ── 課表微調 ──
  {
    const [r] = await chat(fx, "plan", ["不要早八"]);
    record(fx, "排課", "不要早八", r, planValid(r));
  }
  {
    const [r] = await chat(fx, "plan", ["空出星期五"]);
    const v = planValid(r, { avoidDays: [5] });
    record(fx, "排課", "空出星期五", r, v !== true ? v : r.plan?.constraints?.avoidDays?.includes(5) || "沒有空出星期五");
  }
  {
    const [r] = await chat(fx, "plan", ["不要早上的課"]);
    record(fx, "排課", "不要早上的課", r, planValid(r, { noMorning: true }));
  }
  {
    const [r] = await chat(fx, "plan", ["學分不要超過 15"]);
    const v = planValid(r, { maxCredits: 15 });
    record(fx, "排課", "學分不要超過 15", r, v !== true ? v : r.plan?.constraints?.maxCredits === 15 || "上限沒設成 15");
  }
  {
    const shownN = gtPlan?.courses.length ?? 0;
    const [r] = await chat(fx, "plan", ["少一堂課"]);
    const n = r.plan?.plans?.[0]?.courses.length;
    const ok = r.reply.headline.startsWith("這個要求做不到") || n === shownN - 1;
    record(fx, "排課", `少一堂課（眼前 ${shownN} 堂）`, r, planValid(r) !== true ? planValid(r) : ok || `應為 ${shownN - 1} 堂或說明做不到，實際 ${n}`);
  }
  {
    const shown = gtPlan?.courses.map((c) => c.code) ?? [];
    const rs = await chat(fx, "plan", ["不要早八", "多選一堂課"]);
    const r = rs[1]!;
    const before = rs[0].plan?.plans?.[0]?.courses.map((c: any) => c.code) ?? shown;
    const after = r.plan?.plans?.[0]?.courses.map((c: any) => c.code) ?? [];
    const ok = r.reply.headline.startsWith("這個要求做不到") || (after.length === before.length + 1 && before.every((c: string) => after.includes(c)));
    record(fx, "排課", "不要早八 → 多選一堂課", r, planValid(r) !== true ? planValid(r) : ok || `應保留原本 ${before.length} 門再加 1 門`);
  }
  {
    const pick = gtPlan?.courses[0];
    if (pick) {
      const [r] = await chat(fx, "plan", [`把${pick.name}換掉`]);
      const v = planValid(r);
      const gone = !r.plan?.plans?.[0]?.courses.some((c: any) => c.code === pick.code);
      record(fx, "排課", `把${pick.name}換掉`, r, v !== true ? v : gone || `${pick.name} 還在課表裡`);
    }
  }
  {
    // 找一門已經修過的課問「為什麼沒排」：答案要說已修過，不能說查無開課
    const done = rec.courses.find((c) => c.status === "passed" && !c.yearLong && offerings.some((o) => norm(o.name) === norm(c.name)));
    if (done) {
      const [r] = await chat(fx, "plan", [`為什麼沒有排${done.name}？`]);
      record(fx, "排課", `為什麼沒有排${done.name}？（已修過）`, r, /已修|已經修|修畢|已通過|無未修/.test(text(r)) || "沒有說明已經修過");
    }
  }
  {
    const [r] = await chat(fx, "plan", ["課排在三天內就好"]);
    const p = r.plan?.plans?.[0];
    const days = p ? new Set(p.courses.flatMap((c: any) => (c.slots ?? []).map((s: any) => s.day))).size : 0;
    const ok = r.reply.headline.startsWith("這個要求做不到") || /排不進/.test(r.reply.detail ?? "") ? /最少得排在/.test(r.reply.detail ?? "") : days <= 3;
    record(fx, "排課", "課排在三天內就好", r, planValid(r) !== true ? planValid(r) : ok || `排了 ${days} 天，或做不到卻沒說明`);
  }
}

console.log(`\n\n##### ${LABEL}  ${BASE}  ${rows.filter((r) => r.pass).length}/${rows.length} #####`);
let last = "";
for (const r of rows) {
  if (r.fx !== last) { last = r.fx; console.log(`\n── ${r.fx}`); }
  console.log(`${r.pass ? "✅" : "❌"} [${r.g}] ${r.q}\n     ${r.got.slice(0, 160)}${r.pass ? "" : `\n     問題：${r.note}`}`);
}
