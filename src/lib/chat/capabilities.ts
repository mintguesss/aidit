import type { AuditResult, Citation, StudentRecord } from "@/lib/types";
import type { RulePack } from "@/lib/rules/schema";
import { announcementsFor, citationOf } from "@/lib/rules/announcements";
import { allOfferings, remainingSeats } from "@/lib/offerings";
import { formatSlots } from "@/lib/solver/slots";
import type { Reply } from "./types";
import { termLimitsFor } from "@/lib/rules/term-limits";
import { DEFAULT_SCHOOL } from "@/lib/schools";
import { periodScheme, periodLabel } from "@/lib/offerings/period-scheme";
import { programClausesFor } from "@/lib/rules/program-regs";
import { findProgramUnit } from "@/lib/rules/program-units";
import { programUnitLine } from "@/lib/whatif/simulate";
import { findExtraPack, type ExtraPack } from "@/lib/rules/extra-packs";

/**
 * B 介面的能力層（docs/CONVERSATION.md §2.2）。
 *
 * 每一個能力都回傳 Reply，而不是文字：組出來的內容一律只能來自
 * 規則包、公告庫、開課資料庫或審查引擎。查不到就回「不確定」，
 * 絕不以模型記憶中的「一般大學的規定」補足（§0.3、§2.3）。
 */

const ONLY_SUPPORTED = "本系統目前只支援資訊管理學系 111 學年度入學。";

// ------------------------------------------------------- personal-audit

/**
 * 從一段文字找出指的是哪個類別：取與類別名稱最長的共同字串（至少兩個字）。
 *
 * 類別名稱來自這位學生的規則包，不寫死：輔大是「院系必修課程」「本系專業選修」，
 * 合成資料是「系專業選修」。先前離線規則只認得合成資料的名稱，
 * 問「院系必修還差多少」會答成整體進度。
 * 平手就不猜（「選修還差多少」同時對到本系專業選修與其他選修），回 undefined。
 */
export function categoryFromText(audit: AuditResult, text: string): string | undefined {
  // 「課程」「學分」每個類別名稱都可能有，對到它們不代表指哪一類
  const t = text.replace(/\s|課程|學分/g, "");
  const lcs = (a: string) => {
    let best = 0;
    for (let i = 0; i < a.length; i++)
      for (let j = i + 2; j <= a.length; j++) if (t.includes(a.slice(i, j))) best = Math.max(best, j - i);
    return best;
  };
  const scored = audit.categories.map((c) => ({ name: c.name, n: lcs(c.name) })).sort((a, b) => b.n - a.n);
  const top = scored[0];
  const catName = !top || top.n < 2 || scored[1]?.n === top.n ? undefined : top.name;
  // 分項條件（輔大 v0.7 的「本系專業選修」是「選修課程」底下的條件，不是一類）另外比。
  // 要比類別對得更長才算：「通識」對「通識涵養課程」與「三大通識領域」一樣長，仍答類別
  const subs = audit.categories
    .flatMap((c) => c.subRules.filter((s) => typeof s.name === "string" && s.name).map((s) => ({ name: s.name, n: lcs(s.name) })))
    .sort((a, b) => b.n - a.n);
  const sub = subs[0];
  if (sub && sub.n >= 2 && sub.n > (top?.n ?? 0) && subs[1]?.n !== sub.n) return sub.name;
  return catName;
}

/** 名稱是某一類底下的分項條件（「本系專業選修」）時，回傳那一類與那個條件 */
export function subRuleNamed(audit: AuditResult, name: string) {
  for (const cat of audit.categories) {
    const sub = cat.subRules.find((s) => s.name === name);
    if (sub) return { cat, sub };
  }
  return undefined;
}

export function answerPersonalAudit(audit: AuditResult, category?: string): Reply {
  const holds = audit.holds.length;

  // 問的是分項條件（「本系專業選修夠了嗎」）：答那個條件本身，不是整個「選修課程」還差多少
  const named = category ? subRuleNamed(audit, category) : undefined;
  if (named) {
    const { cat, sub } = named;
    return {
      kind: "決定",
      headline: `${sub.name}${sub.status === "satisfied" ? "已滿足" : "還沒達到"}：${sub.detail}`,
      detail:
        `這是「${cat.name}」底下的條件。${cat.name}整體：應修 ${cat.required}、已修 ${cat.earned}、` +
        `修課中 ${cat.inProgress}、未修 ${cat.unmet}。`,
      citations: (sub.citations.length > 0 ? sub.citations : cat.citations).slice(0, 2),
      uncountedHolds: holds,
    };
  }

  if (category) {
    const cat =
      audit.categories.find((c) => c.name.includes(category) || category.includes(c.shortName)) ??
      audit.categories.find((c) => c.name === categoryFromText(audit, category));
    if (!cat) {
      return {
        kind: "不確定",
        headline: `查無「${category}」這個類別。`,
        searched: [`${audit.rulePack.id} 規則包的 ${audit.categories.length} 個類別`],
        contact: "系辦公室課務承辦人",
        citations: [],
      };
    }
    const sub = cat.subRules.find((s) => s.status === "unmet");
    return {
      kind: "決定",
      // 學分還不夠、分項條件也沒過時，兩件都要講：只說「通識還差 4 學分」，
      // 學生隨便修 4 學分的通識，缺的領域還是缺，照樣畢不了業
      headline:
        cat.unmet > 0
          ? sub
            ? `${cat.name}還差 ${cat.unmet} 學分，要注意：${sub.detail}`
            : `${cat.name}還差 ${cat.unmet} 學分。`
          : sub
            ? `${cat.name}學分已足，但${sub.detail}`
            : `${cat.name}已滿足。`,
      detail:
        `應修 ${cat.required}、已修 ${cat.earned}、修課中 ${cat.inProgress}、未修 ${cat.unmet}` +
        (cat.overflow > 0 ? `、超修 ${cat.overflow}（不得流用）` : "") +
        "。",
      citations: cat.citations.slice(0, 2),
      uncountedHolds: holds,
    };
  }

  const short = audit.categories
    .filter((c) => c.unmet > 0)
    .map((c) => `${c.name} ${c.unmet}`)
    .join("、");
  const subOnly = audit.categories.filter((c) => c.status === "unmet" && c.unmet === 0);

  return {
    kind: "決定",
    headline:
      audit.unmet > 0
        ? `還差 ${audit.unmet} 學分（${short}）。`
        : subOnly.length > 0
          ? `學分數已足，但${subOnly.map((c) => c.name).join("、")}的分布條件未達。`
          : "各類別學分均已滿足。",
    detail:
      `畢業最低 ${audit.minCredits}；已修得 ${audit.totalEarned}、可採計 ${audit.countable}、` +
      `修課中 ${audit.inProgress}` +
      (audit.overflow > 0 ? `；超修 ${audit.overflow} 依學則不得流用` : "") +
      "。" +
      // 學分之外的分項條件（通識領域等）也要列，不然「還差 4 學分」看起來修什麼都行
      audit.categories
        .flatMap((c) => c.subRules.filter((s) => s.status === "unmet").map((s) => `\n${c.name}：${s.detail}`))
        .join("") +
      "\n畢業資格以教務處審查為準。",
    citations: audit.categories.filter((c) => c.unmet > 0).flatMap((c) => c.citations.slice(0, 1)),
    uncountedHolds: holds,
  };
}

// ----------------------------------------------------------- regulation

type RuleHit = { text: string; citation: Citation };

/**
 * 規定查詢。
 *
 * 這是最容易出事的地方：模型對「一般大學的規定」有很強的先驗，
 * 很容易編出一條聽起來很合理的規則。因此本函式**只回傳規則包與公告庫裡真的有的條文**，
 * 查不到就回「不確定」，並列出查過哪些來源。
 */
export function answerRegulation(topic: string, pack: RulePack, audit: AuditResult): Reply {
  const hits = searchRules(topic, pack, audit);
  const searched = [
    `${pack.documents.map((d) => d.title).join("、")}`,
    `公告庫（${announcementsFor(pack.school).length} 則）`,
  ];

  // 問的是雙主修、輔系、學程、轉系，查到的卻是別的條文（「雙主修的學分可以抵本系選修嗎」→「選修課程應修 32 學分」）：
  // 那是答非所問。這幾類的規定目前都沒收錄，直接講，並指向辦理單位
  const program = /雙主修|雙學位|輔系|輔修|學程|轉系/.exec(topic)?.[0];
  if (program && !hits.some((h) => h.text.includes(program))) {
    return {
      kind: "不確定",
      headline: `目前收錄的規章沒有${program}的規定，系統不就此作答。`,
      detail: `已收錄的是本系的修業規則與課程規劃表；${program}的申請資格、應修學分與採計方式，以學校的相關辦法與擬修習單位的公告為準。`,
      searched,
      contact: program === "轉系" ? "教務處註冊組、擬轉入學系系辦" : "教務處註冊組、擬修習之學系或學程辦公室",
      citations: [],
    };
  }

  if (hits.length === 0) {
    return {
      kind: "不確定",
      headline: "在目前收錄的規章中查無關於此事的明文規定。",
      detail: ONLY_SUPPORTED,
      searched,
      contact: "系辦公室課務承辦人",
      citations: [],
    };
  }

  // 講到某個學程、但沒收錄它的修習要點：學校的通則照講，並說明那個學程本身的規定沒收錄
  const named = programNameIn(topic);
  const uncollected =
    named && !programPackIn(topic, pack.school ?? "demo")
      ? [
          `目前沒收錄「${named}${/微學程/.test(topic) ? "微學程" : "學程"}」的修習要點，應修科目與學分以開設單位公告為準。`,
          ...(() => {
            const unit = findProgramUnit(pack.school ?? "demo", named);
            const line = unit ? programUnitLine(unit, pack.school ?? "demo") : undefined;
            return line ? [line] : [];
          })(),
        ].join(String.fromCharCode(10))
      : undefined;
  const more = [...(hits.length > 1 ? hits.slice(1, 3).map((h) => h.text) : []), ...(uncollected ? [uncollected] : [])];
  return {
    kind: "決定",
    headline: hits[0]!.text,
    detail: more.length > 0 ? more.join("\n") : undefined,
    citations: hits.slice(0, 3).map((h) => h.citation),
    uncountedHolds: audit.holds.length,
  };
}

/**
 * 以關鍵詞在規則包與公告庫中檢索。比對的是原文，不是模型的記憶。
 * audit 提供學生與排課學期，用於依學年不同的規定（例如修課學分上下限）。
 */
function searchRules(topic: string, pack: RulePack, audit: AuditResult): RuleHit[] {
  const t = topic.replace(/\s/g, "");
  const hits: RuleHit[] = [];
  const cite = (docId: string, locator: string, quote?: string): Citation => {
    const doc = pack.documents.find((d) => d.id === docId);
    return { docId, docTitle: doc?.title ?? docId, locator, quote, publishedAt: doc?.publishedAt };
  };

  const want = (...keys: string[]) => keys.some((k) => t.includes(k));

  // 雙主修、輔系：學校辦法的條文（申請時間、學分下限、免修、延畢）
  const school = pack.school ?? "demo";
  // 學分學程：問到有收錄的學程，先講它自己的修習規定，再講學校通則
  // 學程的課程設計每年不同：依現在申請會適用的那一學年選版本
  const program = programPackIn(t, school, Number(audit.nextTerm.split("-")[0]));
  if (program) hits.push({ text: programSummary(program), citation: programCitation(program) });
  for (const { clause, citation } of programClausesFor(school, t)) {
    hits.push({ text: `${clause.program}：${clause.text}`, citation });
  }

  if (want("超修", "流用", "溢出", "多修的")) {
    for (const [catId, policy] of Object.entries(pack.overflowPolicy)) {
      const cat = pack.categories.find((c) => c.id === catId);
      hits.push({
        text:
          `${cat?.name ?? catId}超過應修學分的部分` +
          `${policy.countsToTotal ? "計入修得總學分" : "不計入修得總學分"}，` +
          "但不得流用至其他類別。",
        citation: cite(policy.citation.docId, policy.citation.locator, policy.citation.quote),
      });
    }
  }

  if (want("領域", "通識", "分布")) {
    for (const cat of pack.categories) {
      for (const sub of cat.subRules) {
        if (sub.type !== "domainCoverage") continue;
        hits.push({
          // 領域數與單位依規則包：輔大是三個領域、各 4 學分，不能說成「四大領域、各 1 門」
          text: `${cat.name}的${sub.domains.join("、")}${"零一二三四五六七八九十"[sub.domains.length] ?? sub.domains.length}大領域，各至少需修習 ${
            sub.minCreditsPerDomain !== undefined ? `${sub.minCreditsPerDomain} 學分` : `${sub.minPerDomain} 門`
          }。`,
          citation: cite(sub.citation.docId, sub.citation.locator, sub.citation.quote),
        });
      }
    }
  }

  if (want("學分上限", "學分下限", "最多", "最少", "一學期")) {
    // 上下限依學年不同時，回答這位學生在排課學期適用的那一組，而不是基本值。
    // 引文用規則包自己的；合成規則包沒有附引文，維持原本的出處
    const lim = termLimitsFor(pack, audit.student, audit.nextTerm);
    const tc = pack.termLimits.citations[0];
    hits.push({
      text:
        pack.termLimits.byStudyYear.length > 0
          ? `你在 ${audit.nextTerm} 適用的修習學分數上限 ${lim.maxCredits}、下限 ${lim.minCredits}（上下限依學年不同）。`
          : `每學期修習學分數上限 ${lim.maxCredits}、下限 ${lim.minCredits}。`,
      citation: tc ? cite(tc.docId, tc.locator, tc.quote) : cite("regulation", "第 22 條", undefined),
    });
  }


  for (const cat of pack.categories) {
    if (!t.includes(cat.name) && !t.includes(cat.shortName)) continue;
    hits.push({
      text: `${cat.name}應修 ${cat.credits} 學分。`,
      citation: cite(cat.citation.docId, cat.citation.locator, cat.citation.quote),
    });
    for (const amb of cat.ambiguities) {
      hits.push({
        text: `注意：${amb.description}。此處規定有缺口，系統不就此作判定。`,
        citation: cite(amb.citation.docId, amb.citation.locator, amb.citation.quote),
      });
    }
  }

  // 畢業條件用名稱裡的關鍵字比：「英文畢業門檻」要對到「英文能力（CEF B2）」，不能要求整串名稱都出現
  for (const g of pack.graduationChecks) {
    if (!t.includes(g.name) && !nameKeys(g.name).some((k) => t.includes(k))) continue;
    hits.push({
      // 有原文就直接講規定本身；「依學校共同規定辦理」等於沒回答
      text:
        g.rule === "deptDefined"
          ? `${g.name}的標準由各系自訂，規劃表本身未載明具體門檻。`
          : g.citation.quote && g.citation.quote.length > g.name.length + 2
            ? `${g.name}：${g.citation.quote.replace(/^(?:及|與|並|且|和)/, "")}。`
            : `${g.name}依學校共同規定辦理。`,
      citation: cite(g.citation.docId, g.citation.locator, g.citation.quote),
    });
  }

  for (const ann of announcementsFor(pack.school)) {
    const target = [...pack.categories, ...pack.graduationChecks].find((x) => ann.targets.includes(x.id));
    if (!target || !t.includes(target.name)) continue;
    hits.push({
      text:
        ann.appliesToYears === null
          ? `另有公告「${ann.title}」，但全文未載明適用之入學學年，系統不據以判定。`
          : `另有公告「${ann.title}」，適用 ${ann.appliesToYears[0]} 學年度起入學之學生。`,
      citation: citationOf(ann, ann.appliesToRaw ? "第 1 點適用對象" : "全文", ann.appliesToRaw ?? undefined),
    });
  }

  // 「畢業條件有哪些」：學分以外的條件逐項列出
  if (want("畢業條件", "畢業門檻有哪些", "畢業規定有哪些") && pack.graduationChecks.length > 0 && !hits.some((h) => pack.graduationChecks.some((g) => h.text.startsWith(g.name)))) {
    hits.push({
      text: `畢業除了修滿 ${pack.minCredits} 學分，還要符合：${pack.graduationChecks.map((g) => g.name).join("、")}。`,
      citation: pack.minCreditsCitation
        ? cite(pack.minCreditsCitation.docId, pack.minCreditsCitation.locator, pack.minCreditsCitation.quote)
        : cite(pack.categories[0]!.citation.docId, "第 1 頁修業基本規定"),
    });
  }

  // 最低畢業學分：問總學分時答；只說了「畢業」的，有更具體的答案（英文門檻、某一類）就不搶第一句
  // 問的是雙主修、輔系、學程的學分，不是本系畢業學分
  const aboutProgram = /雙主修|雙學位|輔系|輔修|學程/.test(t);
  if ((want("最低", "總學分", "幾學分") && !aboutProgram) || (want("畢業") && hits.length === 0)) {
    hits.push({
      text: `本系（${pack.program === "day" ? "日間部" : "進修部"}）最低畢業學分 ${pack.minCredits} 學分。`,
      citation: pack.minCreditsCitation
        ? cite(pack.minCreditsCitation.docId, pack.minCreditsCitation.locator, pack.minCreditsCitation.quote)
        : cite(pack.categories[0]!.citation.docId, "第 1 頁修業基本規定"),
    });
  }

  // 同一條 locator 只留一次
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = `${h.citation.docId}|${h.citation.locator}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 原句是否在問本系某一項畢業條件（「英文要考到多少才能畢業」「程式語言機測是什麼」）。
 * 規則的關鍵字清單是各系通用的，認不得這些系自訂的條件名稱；模型又常把它們判成超出範圍。
 * 光有名稱裡的字還不夠（「程式」也會出現在閒聊裡），要同時帶有問規定的語氣。
 */
export function mentionsGraduationCheck(text: string, pack: RulePack): boolean {
  const t = text.replace(/\s/g, "");
  if (!/畢業|門檻|規定|要考|考試|考到|是什麼|什麼是|要不要|需不需要|一定要|標準|條件|怎麼算|怎麼過/.test(t)) return false;
  return pack.graduationChecks.some((g) => t.includes(g.name) || nameKeys(g.name).some((k) => t.includes(k)));
}

/** 句子裡講到的、有收錄的學分學程（「雲端學程」→ 雲端服務學程） */
export function programPackIn(text: string, school: string, startYear?: number): ExtraPack | undefined {
  const name = programNameIn(text);
  return name ? findExtraPack("cert-program", { program: name, school, startYear }) : undefined;
}

/** 句子裡講到的學程名稱（「AI微學程」→ AI）；只說「學程」「學分學程」的回 undefined */
export function programNameIn(text: string): string | undefined {
  if (!/學程/.test(text)) return undefined;
  const m = /([A-Za-z一-龥]{2,14}?)(?:學分|微)?學程/.exec(text);
  const name = (m?.[1] ?? "")
    .replace(/^.*?(?:加修|申請|想修|修讀|要修|能修|修|讀|念)/, "")
    .replace(/^(?:我|想要?|要|能不能|可不可以|可以|一個|這個|那個)+/, "")
    .replace(/(?:學分|微)$/, "");
  return name.length >= 2 && !/^(?:什麼|哪個|哪些|跨領域|學分|這|那)$/.test(name) ? name : undefined;
}

function programSummary(p: ExtraPack): string {
  const parts = p.requirements.map((r) => (r.minCourses ? `${r.label.replace(/（.*）$/, "")} ${r.minCourses} 門` : `${r.label} ${r.credits} 學分`));
  return `${p.title}：${parts.join("、")}，共至少 ${p.minCredits} 學分。${p.overlapPolicy}`;
}

function programCitation(p: ExtraPack, c: { docId: string; locator: string; quote: string } = p.requirements[0]!.citation): Citation {
  return { docId: c.docId, docTitle: p.document.title, locator: c.locator, quote: c.quote, publishedAt: p.document.publishedAt || undefined };
}

/**
 * 「我想修雲端學程，如何申請」「雙主修要怎麼申請」：有收錄的就照收錄的規定講，
 * 沒有才交給一般的辦理流程（那只說得出「向開設單位申請」）
 */
export function answerProgramProcedure(text: string, pack: RulePack): Reply | null {
  if (!/申請|報名|怎麼修|如何修/.test(text)) return null;
  const school = pack.school ?? "demo";
  const program = programPackIn(text, school);
  if (program?.apply) {
    // 學校的學程辦法：沒事先申請、畢業前修完也能申請認定；申請單要本系系主任簽章
    const school_ = programClausesFor(school, "學程 認定 怎麼申請").filter((x) => x.clause.locator === "第六條" || x.clause.docId);
    return {
      kind: "決定",
      headline: `${program.title}的申請方式：${program.apply.text}`,
      detail: [programSummary(program), ...school_.map((x) => `學校規定：${x.clause.text}`)].join(String.fromCharCode(10)),
      citations: [programCitation(program, program.apply.citation), programCitation(program), ...school_.map((x) => x.citation)],
    };
  }
  const clauses = programClausesFor(school, `${text} 怎麼申請 什麼時候`);
  if (clauses.length === 0) return null;
  return {
    kind: "決定",
    headline: clauses.map((x) => `${x.clause.program}：${x.clause.text}`).join(""),
    detail: "各系的資格與名額依教務處當學期公告，申請前請先看公告。",
    citations: clauses.map((x) => x.citation),
    contact: "教務處註冊組、擬修習學系系辦",
  };
}

/** 畢業條件名稱裡可以拿來比對的字：去掉括號內容與「能力」「學分」這類每條都有的字，取兩字一組 */
function nameKeys(name: string): string[] {
  const core = name.replace(/[（(][^）)]*[）)]/g, "").replace(/\s/g, "");
  const out: string[] = [];
  for (let i = 0; i + 2 <= core.length; i++) {
    const k = core.slice(i, i + 2);
    if (!/能力|學分|課程|時間|條件|畢業|修課|檢測|學期|學習|專業|授課|教育/.test(k)) out.push(k);
  }
  return out;
}

// ---------------------------------------------------------- course-info

export function answerCourseInfo(query: string, nextTerm: string, school: string = DEFAULT_SCHOOL, dept?: string): Reply {
  const q = query.replace(/\s/g, "");
  // 只找學生自己學校的課：各校常有同名的課，查到別校的時段與教師是錯誤資訊
  const all = allOfferings(school);
  const hits = all.filter(
    (o) => o.code.toUpperCase() === q.toUpperCase() || o.name.includes(q) || q.includes(o.name),
  );

  if (hits.length === 0) {
    return {
      kind: "不確定",
      headline: `開課資料中查無「${query}」。`,
      searched: [`${nextTerm} 開課資料（${all.length} 門）`],
      contact: "教務處課務組",
      citations: [],
    };
  }

  // 只列學生下學期那一期的班。開課資料存了好幾個學期，不分學期的話，
  // 問「人生哲學什麼時候上課」會列出 111-2 的班，還把各學期的班混在一起。
  // 下學期沒開才退而列最近一期，並且明講下學期沒開
  const termOf = (o: (typeof hits)[number]) => `${o.year}-${o.term}`;
  const inNext = hits.filter((o) => termOf(o) === nextTerm);
  const latest = [...new Set(hits.map(termOf))].sort().at(-1)!;
  const termRows = inNext.length > 0 ? inNext : hits.filter((o) => termOf(o) === latest);
  // 有本系保留班的課只列本系的班：人生哲學七十幾班，資管學生能選的只有資管那 2 班（見排課的 ownDeptCodes）
  const ownCodes = new Set(dept ? termRows.filter((o) => o.dept === dept).map((o) => o.code) : []);
  const shown = termRows.filter((o) => !ownCodes.has(o.code) || o.dept === dept);
  const otherDept = termRows.length - shown.length;

  const lines = [...new Set(shown.map((o) => {
    const seats = remainingSeats(o);
    // 節次名稱依學校：輔大的內部第 6 節是 D5
    const scheme = periodScheme(o.school);
    const slot = o.slotsUnknown ? `時段未知（原始：${o.rawSlotText}）` : formatSlots(o.slots, false, (p) => periodLabel(scheme, p));
    const prereq = o.prerequisites.find((p) => p.confidence === "explicit");
    return (
      `${o.code} ${o.name}　${o.credits} 學分　${o.teacher}　${slot}　` +
      (seats === null ? "餘額未知" : `餘額 ${seats}／${o.capacity}`) +
      (prereq ? `　先修 ${prereq.codes.join("、")}` : "")
    );
  }))];
  const first = shown[0]!;
  const more = lines.length > 8 ? `\n（共 ${lines.length} 個班，只列前 8 個）` : "";

  return {
    kind: "決定",
    headline:
      inNext.length > 0
        ? `${first.name}（${first.code}）${nextTerm} 開 ${lines.length} 個班${otherDept > 0 ? "可選" : ""}。`
        : `${first.name}（${first.code}）${nextTerm} 沒有開課；最近一次是 ${latest}。`,
    detail:
      lines.slice(0, 8).join("\n") +
      more +
      (otherDept > 0 ? `\n另有 ${otherDept} 班是開給別系的，不列出。` : ""),
    // 開課資料不是規章，其「依據」是資料本身的抓取時間，於頁尾標示
    citations: [],
  };
}

// ------------------------------------------------------------ procedure

type Procedure = { keys: string[]; what: string; how: string; contact: string; deadline?: string };

/**
 * 辦理流程。
 *
 * 這些不是判定，是「去哪裡辦」。內容取自學則與各處室的公開規定；
 * 沒有收錄的事項一律回「不確定」並指向承辦單位，不自行編造流程。
 */
const PROCEDURES: Procedure[] = [
  {
    keys: ["抵免", "採認", "學分抵免"],
    what: "學分抵免申請",
    how: "檢附原校成績單影本與課程大綱，於開學前兩週向教務處註冊組送件；抵免科目與本校科目的對照以公告之對照表為準。",
    contact: "教務處註冊組",
    deadline: "開學前兩週",
  },
  {
    keys: ["停修", "退選", "撤選"],
    what: "停修申請",
    how: "於停修期間內於校務系統提出申請，經授課教師與系主任同意後生效。停修之科目不計學分，亦不列入該學期修習學分數之計算。",
    contact: "教務處註冊組",
    deadline: "期中考後一週內（實際日期依行事曆）",
  },
  {
    keys: ["輔系", "雙主修"],
    what: "輔系／雙主修申請",
    how: "依各系公告之申請期間與資格向擬修習之學系提出。本系統尚未收錄各系的輔系應修科目與學分規定。",
    contact: "擬修習之學系系辦公室",
  },
  {
    keys: ["學程", "學分學程"],
    what: "學分學程申請",
    how: "向開設該學程的單位提出申請。本系統尚未收錄各學程的應修科目與學分規定。",
    contact: "開設學程之單位",
  },
  {
    keys: ["加簽", "人工加選", "額滿"],
    what: "加簽",
    how: "課程額滿時，須於加退選期間取得授課教師同意後，依教務處公告之方式辦理。本系統不代為加選。",
    contact: "授課教師與教務處課務組",
  },
  {
    keys: ["畢業審查", "畢業資格", "離校"],
    what: "畢業資格審查",
    how: "由教務處於應屆畢業學期辦理。本系統的判定僅供修業規劃參考，不作為畢業資格證明。",
    contact: "教務處註冊組",
  },
  {
    keys: ["英文檢定", "語言檢定", "英檢"],
    what: "英文能力檢定認定",
    how: "檢附檢定成績證明向系辦公室查驗。本系所適用之通過標準，系統查無載明適用學年的明文。",
    contact: "系辦公室",
  },
];

export function answerProcedure(query: string): Reply {
  const q = query.replace(/\s/g, "");
  const hit = PROCEDURES.find((p) => p.keys.some((k) => q.includes(k)));
  if (!hit) {
    return {
      kind: "不確定",
      headline: "系統未收錄這項事務的辦理流程。",
      searched: [`已收錄的辦理事項（${PROCEDURES.length} 項）`],
      contact: "教務處註冊組或系辦公室",
      citations: [],
    };
  }
  return {
    kind: "決定",
    headline: `${hit.what}：${hit.contact}辦理。`,
    detail: hit.how + (hit.deadline ? `\n期限：${hit.deadline}（實際日期以行事曆公告為準）` : ""),
    contact: hit.contact,
    citations: [],
  };
}

// --------------------------------------------------------- 能力邊界

/** §2.5 能力邊界要主動說 */
export function capabilityLimits(record: StudentRecord, pack: RulePack): string[] {
  const out: string[] = [`本系統目前只支援 ${pack.dept} ${pack.admissionYear} 學年度入學。`];
  if (!record.courses.some((c) => c.status === "waived")) {
    out.push("本次資料來源未提供抵免紀錄，相關問題無法判定。");
  }
  if (!record.graduationEvidence) {
    out.push("本次資料來源未提供畢業條件佐證，語言與服務學習相關問題無法判定。");
  }
  return out;
}
