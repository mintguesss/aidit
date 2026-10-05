import { contentHash } from "@/lib/util/identity";
import { normalize } from "@/lib/util/text";
import { editableOf, type Editable, type EditLogEntry } from "./edit";

/**
 * 草稿 → 校對項目。
 *
 * 校對的人多半是系辦或學生，不是工程師。這裡產生的每一句話都要「不懂 JSON 也看得懂」：
 * 不出現欄位名（courseList、day、countsToTotal），課號旁邊一定附課名，
 * 並寫明這一項要確認的是什麼。原文出處附上原始文件的連結與頁碼，不必自己去找檔案。
 */

export type ReviewItem = {
  id: string;
  kind: "category" | "subRule" | "ambiguity" | "graduationCheck" | "overflowPolicy" | "meta";
  label: string;
  /** 系統對這條規定的理解，一句白話 */
  extracted: string;
  /** 補充明細，例如算進這一類的課程清單 */
  details?: string[];
  /** 校對時要確認的事 */
  question: string;
  /**
   * 給校對者的補充說明（草稿的 `_draft.itemNotes`）—— 回覆上一輪的修正、解釋原文。
   * 不算規則內容，不進 hash：加說明不會讓已通過的項目被迫重看。
   */
  note?: string;
  /** 可以在校對頁直接修改的欄位與目前的值；null 表示只能留言給維護者 */
  editable: Editable | null;
  /** 這一項在校對頁被改過的紀錄 */
  edits: EditLogEntry[];
  docId: string;
  /** 原始文件的標題與網址，校對時點開對照整份文件 */
  docTitle?: string;
  docUrl?: string;
  /** 由 locator 解析出的頁碼，連結會跳到該頁（瀏覽器內建的 PDF 檢視器支援 #page=） */
  page?: number;
  locator: string;
  quote?: string;
  /** 原文中 quote 前後的上下文，供校對時對照 */
  context?: { before: string; match: string; after: string } | null;
  /**
   * 這一項內容的雜湊。草稿改版時，內容沒變的項目沿用原本的校對結果，
   * 只有改到的項目要重新校對（見 store.ts 的 loadRecord）。
   */
  hash: string;
};

type Citation = { docId: string; locator: string; quote?: string };
type Doc = { id: string; title: string; url?: string };

const PROGRAM: Record<string, string> = { day: "日間學士班", night: "進修學士班" };

export function toItems(draft: Record<string, unknown>, corpus: Map<string, string>): ReviewItem[] {
  const items: ReviewItem[] = [];
  const docs = new Map(((draft.documents as Doc[] | undefined) ?? []).map((d) => [d.id, d]));
  const titles = ((draft._draft as { courseTitles?: Record<string, string> } | undefined)?.courseTitles ?? {}) as Record<
    string,
    string
  >;
  const yearLong = new Set((draft.yearLongCourses as string[] | undefined) ?? []);
  const editLog = ((draft._draft as { edits?: EditLogEntry[] } | undefined)?.edits ?? []) as EditLogEntry[];
  const notes = ((draft._draft as { itemNotes?: Record<string, string> } | undefined)?.itemNotes ?? {}) as Record<
    string,
    string
  >;
  const course = (code: string) =>
    `${titles[code] ?? "（課名未知）"}　${code}${yearLong.has(code) ? "　全學年（上下學期都要修）" : ""}`;

  const push = (
    id: string,
    kind: ReviewItem["kind"],
    label: string,
    body: { extracted: string; details?: string[]; question: string },
    c: Citation | undefined,
    /** 這一項背後的規則資料。雜湊只算它和引文，不算畫面上的文字 */
    data: unknown,
  ) => {
    const doc = c ? docs.get(c.docId) : undefined;
    const pageMatch = c?.locator.match(/第\s*(\d+)\s*頁/);
    items.push({
      id,
      kind,
      label,
      ...body,
      docId: c?.docId ?? "",
      locator: c?.locator ?? "",
      quote: c?.quote,
      docTitle: doc?.title,
      docUrl: doc?.url,
      page: pageMatch ? Number(pageMatch[1]) : undefined,
      context: c?.quote ? locate(corpus.get(c.docId) ?? "", c.quote) : null,
      note: notes[id],
      editable: editableOf(draft, id),
      edits: editLog.filter((e) => e.itemId === id),
      // 用規則資料算，不用畫面文字：改措辭不該讓已通過的項目被迫重看，改規則才該
      hash: contentHash({ data, citation: c ?? null }),
    });
  };

  // ------------------------------------------------------------ 畢業最低學分
  const scope = [
    `${draft.admissionYear} 學年度入學`,
    PROGRAM[draft.program as string] ?? String(draft.program),
  ].join("、");
  push(
    "meta",
    "meta",
    "畢業最低學分",
    {
      extracted: `畢業至少要修滿 ${draft.minCredits} 學分（適用：${scope}）。`,
      question: `原文寫的畢業最低學分是不是 ${draft.minCredits}？`,
    },
    draft.minCreditsCitation as Citation | undefined,
    { minCredits: draft.minCredits, admissionYear: draft.admissionYear, program: draft.program },
  );

  // ------------------------------------------------------------ 學分類別
  type Match =
    | { type: "courseList"; codes: string[] }
    | { type: "courseNames"; names: string[]; prefixes?: string[] }
    | { type: "selectType"; value: string }
    | { type: "deptElective"; dept: string; excludeNames?: string[] }
    | { type: "anyPassed" };
  type SubRule =
    | {
        type: "domainCoverage";
        id: string;
        name: string;
        domains: string[];
        minPerDomain: number;
        minCreditsPerDomain?: number;
        citation: Citation;
      }
    | { type: "minCoursesFromList"; id: string; name: string; codes: string[]; minCourses: number; citation: Citation }
    | { type: "minDeptCredits"; id: string; name: string; dept: string; minCredits: number; citation: Citation };
  type Cat = {
    id: string;
    name: string;
    credits: number;
    match: Match;
    citation: Citation;
    subRules?: SubRule[];
    ambiguities?: { id: string; description: string; contact: string; citation: Citation }[];
  };

  type Check = {
    id: string;
    name: string;
    rule: string;
    contact: string;
    category?: string;
    courseNames?: string[];
    minTerms?: number;
    citation: Citation;
  };
  const checks = (draft.graduationChecks as Check[] | undefined) ?? [];
  const cats = (draft.categories as Cat[] | undefined) ?? [];
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const minCredits = Number(draft.minCredits);

  for (const cat of cats) {
    // 0 學分的必修（體育）不影響學分數，但屬於這一類，寫出來免得看起來漏列
    const members = checks.filter((g) => g.category === cat.id);
    const memberText = members.length
      ? `（另含${members.map((g) => `「${g.name}」`).join("、")}，0 學分，另列在「其他畢業條件」檢查）`
      : "";
    const need = `這一類要修滿 ${cat.credits} 學分${memberText}。`;
    let body: { extracted: string; details?: string[]; question: string };
    const m = cat.match;
    switch (m.type) {
      case "courseList":
        body = {
          extracted: `${need}只有下面這 ${m.codes.length} 門課算在這一類（課名　課號）：`,
          details: m.codes.map(course),
          question: "學分數和原文一樣嗎？課程有沒有漏列或多列？全學年的標記對嗎？",
        };
        break;
      case "courseNames":
        body = {
          extracted: `${need}成績單上課名符合下列其中一種的課，算在這一類：`,
          details: [
            ...m.names.map((n) => `課名就是「${n}」（一字不差）`),
            ...(m.prefixes ?? []).map((p) => `課名以「${p}」開頭（例如「${p}(…)」，括號裡寫什麼都算）`),
          ],
          question:
            "學分數和原文一樣嗎？你的成績單上，這一類的課真的是這樣寫嗎？若成績單上寫成別的名稱（例如「英文（一）」），請按「需要修正」把實際課名寫下來。",
        };
        break;
      case "selectType":
        body = {
          extracted: `${need}成績單上標為「${m.value === "general" ? "通識" : m.value === "required" ? "必修" : "選修"}」的課都算在這一類。`,
          question: "學分數和原文一樣嗎？",
        };
        break;
      case "deptElective":
        body = {
          extracted: `${need}本系開的選修課都算在這一類${m.excludeNames?.length ? "，但下面這幾門除外（只能算其他選修）：" : "。"}`,
          details: m.excludeNames,
          question: m.excludeNames?.length
            ? "學分數和原文一樣嗎？除外的課對嗎？"
            : "學分數和原文一樣嗎？",
        };
        break;
      case "anyPassed": {
        const others = cats.filter((c) => c !== cat).reduce((a, c) => a + c.credits, 0);
        body = {
          extracted:
            `${need}任何及格的課都可以算進來（例如外系選修、修超過的系專選）。` +
            `這個數字是畢業最低學分 ${minCredits} 減去其他各類合計 ${others} 算出來的。`,
          question: "原文是不是這樣規定畢業學分的組成？",
        };
        break;
      }
    }
    const { subRules: _s, ambiguities: _a, ...rule } = cat;
    const listed = m.type === "courseList" ? m.codes : [];
    push(`category:${cat.id}`, "category", `學分類別：${cat.name}`, body, cat.citation, {
      rule,
      titles: listed.map((code) => [code, titles[code] ?? null, yearLong.has(code)]),
      members: members.map((g) => g.name),
      others: m.type === "anyPassed" ? cats.filter((c) => c !== cat).reduce((a, c) => a + c.credits, 0) : null,
    });

    for (const s of cat.subRules ?? []) {
      const extracted =
        s.type === "domainCoverage"
          ? s.minCreditsPerDomain
            ? `${s.domains.join("、")}，每個領域各至少修 ${s.minCreditsPerDomain} 學分。`
            : `${s.domains.join("、")}，每個領域各至少修 ${s.minPerDomain} 門。`
          : s.type === "minDeptCredits"
            ? `「${cat.name}」採計的課裡，至少要有 ${s.minCredits} 學分是本系開的選修。` +
              `本系選修修超過的也還是算在「${cat.name}」裡，不會因為湊不出剛好的數字被當成不足。`
            : `下列課程至少要修 ${s.minCourses} 門：`;
      push(
        `subRule:${s.id}`,
        "subRule",
        `附加條件（${cat.name}）：${s.name}`,
        {
          extracted,
          details: s.type === "minCoursesFromList" ? s.codes.map(course) : undefined,
          question:
            s.type === "minDeptCredits"
              ? "原文是不是「選修課程中包含本系專業選修至少這麼多學分」？"
              : "領域名稱和每個領域的要求和原文一樣嗎？",
        },
        s.citation,
        { sub: s, titles: s.type === "minCoursesFromList" ? s.codes.map((code) => titles[code] ?? null) : null },
      );
    }
    for (const a of cat.ambiguities ?? []) {
      push(
        `ambiguity:${a.id}`,
        "ambiguity",
        `需要人工判斷的情況（${cat.name}）`,
        {
          extracted: `${a.description}遇到這種情況時，系統不自行判斷，請學生洽詢「${a.contact}」。`,
          question: "原文是否真的沒有說清楚、需要承辦單位認定？",
        },
        a.citation,
        a,
      );
    }
  }

  // ------------------------------------------------------------ 畢業條件
  for (const g of checks) {
    const within = g.category ? `屬於「${catName.get(g.category) ?? g.category}」，` : "";
    push(
      `check:${g.id}`,
      "graduationCheck",
      `其他畢業條件：${g.name}`,
      {
        extracted:
          g.rule === "deptDefined"
            ? `畢業前必須完成「${g.name}」（${within}文件只寫由系上另訂）。系統會請學生洽詢「${g.contact}」。`
            : g.rule === "passedCourse"
              ? `畢業前必須修過${(g.courseNames ?? []).map((n) => `「${n}」`).join("或")}` +
                `${(g.minTerms ?? 1) > 1 ? ` ${g.minTerms} 個學期` : ""}${within ? `（${within.slice(0, -1)}）` : ""}。` +
                `系統直接看成績單上的課名（一字不差）；找不到時列為待確認，不會直接判未修。`
              : `畢業前必須完成「${g.name}」${within ? `（${within.slice(0, -1)}）` : ""}。系統目前不從成績單判斷這一項，會請學生自行確認，或洽詢「${g.contact}」。`,
        question:
          g.rule === "passedCourse"
            ? "這真的是畢業條件嗎？你成績單上的課名是這樣寫嗎？"
            : "這真的是畢業條件嗎？名稱和要求和原文一樣嗎？",
      },
      g.citation,
      { check: g, categoryName: g.category ? (catName.get(g.category) ?? null) : null },
    );
  }

  // ------------------------------------------------------------ 超修
  type Overflow = { countsToTotal: boolean; transferable: boolean; citation: Citation };
  const policies = (draft.overflowPolicy as Record<string, Overflow> | undefined) ?? {};
  for (const [k, v] of Object.entries(policies)) {
    const name = catName.get(k) ?? k;
    push(
      `overflow:${k}`,
      "overflowPolicy",
      `修超過的學分：${name}`,
      {
        extracted:
          (v.countsToTotal
            ? `「${name}」修超過規定的學分，仍可算進畢業總學分`
            : `「${name}」修超過規定的學分，不算進畢業總學分`) +
          (v.transferable ? "，也可以拿去抵其他類別。" : "，也不能拿去抵其他類別。"),
        question: "原文對修超過的學分是這樣規定的嗎？",
      },
      v.citation,
      { policy: v, name },
    );
  }

  // ------------------------------------------------------------ 每學期修課學分
  type Limits = {
    maxCredits: number;
    minCredits: number;
    byStudyYear?: { fromYear: number; maxCredits?: number; minCredits?: number }[];
    citations?: Citation[];
  };
  const limits = draft.termLimits as Limits | undefined;
  if (limits) {
    const adjust = (limits.byStudyYear ?? []).map((o) => {
      const parts = [
        o.minCredits ? `最少 ${o.minCredits} 學分` : "",
        o.maxCredits ? `最多 ${o.maxCredits} 學分` : "",
      ].filter(Boolean);
      return `第 ${o.fromYear} 學年（大${"一二三四五六"[o.fromYear - 1] ?? o.fromYear}）起改為${parts.join("、")}`;
    });
    const extracted =
      `每學期最少修 ${limits.minCredits} 學分、最多 ${limits.maxCredits} 學分` +
      (adjust.length ? `；${adjust.join("；")}` : "") +
      "。排課時會照這個範圍。";
    const cites = limits.citations ?? [];
    const body = { extracted, question: "和這段原文對得起來嗎？（同一組數字分成幾段原文，請逐段確認）" };
    const { citations: _c, ...rule } = limits;
    if (cites.length === 0) push("termLimits:0", "meta", "每學期修課學分", body, undefined, rule);
    cites.forEach((c, i) =>
      push(`termLimits:${i}`, "meta", `每學期修課學分（${i + 1}/${cites.length}）`, body, c, rule),
    );
  }

  return items;
}

/** 上下文單側最多幾個字；超過就截斷並標「…」 */
const CONTEXT_MAX = 300;

const lineStart = (s: string, i: number) => s.lastIndexOf("\n", i - 1) + 1;
const lineEnd = (s: string, i: number) => {
  const j = s.indexOf("\n", i);
  return j < 0 ? s.length : j;
};

/**
 * 高亮段落的前後文：往前補到上一個「非空白行」的行首，往後補到下一個非空白行的行尾。
 *
 * 以前固定前後各取 80 字，常常從句子中間切開（校對者回報「原文常常沒切完整」）。
 * 條文是一行一行排的，以整行為單位才讀得懂。單側最多 CONTEXT_MAX 字，避免一大段表格整片倒出來。
 */
function around(source: string, start: number, end: number): { before: string; after: string } {
  let from = lineStart(source, start);
  while (from > 0) {
    from = lineStart(source, from - 1);
    if (source.slice(from, lineEnd(source, from)).trim() !== "") break;
  }
  let to = lineEnd(source, end);
  while (to < source.length) {
    const next = to + 1;
    to = lineEnd(source, next);
    if (source.slice(next, to).trim() !== "") break;
  }
  const cutBefore = start - from > CONTEXT_MAX;
  const cutAfter = to - end > CONTEXT_MAX;
  return {
    before: (cutBefore ? "…" : "") + source.slice(cutBefore ? start - CONTEXT_MAX : from, start),
    after: source.slice(end, cutAfter ? end + CONTEXT_MAX : to) + (cutAfter ? "…" : ""),
  };
}

/** 在原文中定位 quote，回傳前後文供高亮 */
export function locate(source: string, quote: string): ReviewItem["context"] {
  const idx = source.indexOf(quote);
  if (idx >= 0) {
    return { ...around(source, idx, idx + quote.length), match: quote };
  }

  // 找不到完全相同的字串時，改用與 citation.verify 同一套正規化規則再找一次。
  // 版面模式抽出的語料有大量補齊空白與換行（「核心課程         8學分」），
  // 只用 indexOf 的話，驗證通過的引文在校對頁上會找不到原文位置 ——
  // 而校對的人最需要的正是那段上下文。
  //
  // normalize 是逐字元的轉換（全半形、去空白標點、轉小寫），所以可以逐字元正規化，
  // 同時記下每個字元在原文的位置，比對到之後再映射回原文。
  const at: number[] = [];
  let compact = "";
  for (let i = 0; i < source.length; i++) {
    const n = normalize(source[i]!);
    for (let k = 0; k < n.length; k++) at.push(i);
    compact += n;
  }
  const q = normalize(quote);
  const j = q ? compact.indexOf(q) : -1;
  if (j < 0) return null;

  const start = at[j]!;
  const end = at[j + q.length - 1]! + 1;
  return {
    ...around(source, start, end),
    // 回傳原文實際的那一段（含排版空白），畫面高亮的才是原文，而不是引文
    match: source.slice(start, end),
  };
}
