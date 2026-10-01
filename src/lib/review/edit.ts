import { z } from "zod";
import { zRulePack } from "@/lib/rules/schema";
import { validatePack } from "@/lib/rules/validate";
import { numberValuesOf } from "@/lib/util/text";

/**
 * 校對頁的「直接修改」。
 *
 * 以前按「需要修正」只能留一段文字，要等工程師改 JSON、重新上傳 —— 系辦用不了。
 * 現在常見的修改（學分數、課程清單、課名、畢業條件、學分上下限、超修）直接在頁面上改：
 *
 *   1. 每種項目只開放固定幾個欄位（Editable），不能改到別的地方
 *   2. 改完要過跟上傳草稿一樣的自動驗證（lib/rules/validate.ts），外加一條：
 *      改了數字，依據的原文裡必須找得到這個數字 —— 不然就是「改了值、沒換依據」
 *   3. 通過才存成新版草稿，並記下誰、何時、從什麼改成什麼、為什麼（`_draft.edits`）
 *   4. 改到的項目雜湊會變，自動回到「還沒看」，要再按一次通過；沒改到的不受影響
 *
 * 表單改不了的（要新的判定方式、規則結構要動）仍走「留言給維護者」。
 */

const zCit = z.object({
  docId: z.string().min(1),
  locator: z.string().min(1),
  quote: z.string().min(1, "請貼上依據的原文句子"),
});
export type EditCitation = z.infer<typeof zCit>;

const lines = z.array(z.string().trim().min(1));

export const zEditable = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("minCredits"), minCredits: z.number().int().positive(), citation: zCit }),
  z.object({
    kind: z.literal("category"),
    matchType: z.enum(["courseList", "courseNames", "selectType", "deptElective", "anyPassed"]),
    credits: z.number().int().nonnegative(),
    /** courseList：課號與課名（課名只用於顯示，存在 `_draft.courseTitles`） */
    courses: z.array(z.object({ code: z.string().trim().min(1), title: z.string().trim() })).optional(),
    names: lines.optional(),
    prefixes: lines.optional(),
    excludeNames: lines.optional(),
    citation: zCit,
  }),
  z.object({
    kind: z.literal("domainCoverage"),
    domains: lines.min(1),
    minCreditsPerDomain: z.number().int().positive().nullable(),
    citation: zCit,
  }),
  z.object({
    kind: z.literal("check"),
    name: z.string().trim().min(1),
    rule: z.enum(["evidence", "deptDefined", "passedCourse"]),
    courseNames: lines,
    minTerms: z.number().int().positive(),
    citation: zCit,
  }),
  z.object({ kind: z.literal("overflow"), countsToTotal: z.boolean(), citation: zCit }),
  z.object({
    kind: z.literal("termLimits"),
    minCredits: z.number().int().positive(),
    maxCredits: z.number().int().positive(),
    byStudyYear: z.array(
      z.object({
        fromYear: z.number().int().min(1).max(7),
        minCredits: z.number().int().positive().optional(),
        maxCredits: z.number().int().positive().optional(),
      }),
    ),
    citation: zCit,
  }),
]);
export type Editable = z.infer<typeof zEditable>;

export type EditLogEntry = {
  itemId: string;
  by: string;
  at: string;
  reason: string;
  changes: string[];
};

export class EditError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("；"));
  }
}

type Draft = Record<string, unknown>;
type Cit = { docId: string; locator: string; quote?: string };
type AnyCat = {
  id: string;
  name: string;
  credits: number;
  match: Record<string, unknown> & { type: string };
  citation: Cit;
  subRules?: (Record<string, unknown> & { id: string; type: string; citation: Cit })[];
};
type AnyCheck = Record<string, unknown> & { id: string; name: string; rule: string; citation: Cit };

const cit = (c: Cit | undefined | null): EditCitation => ({
  docId: c?.docId ?? "",
  locator: c?.locator ?? "",
  quote: c?.quote ?? "",
});

const titlesOf = (draft: Draft) =>
  ((draft._draft as { courseTitles?: Record<string, string> } | undefined)?.courseTitles ?? {}) as Record<string, string>;

// ------------------------------------------------------------ 目前的值

/** 這一項目前可以改的欄位與值；不開放修改的項目回傳 null */
export function editableOf(draft: Draft, itemId: string): Editable | null {
  const [kind, ref] = splitId(itemId);
  const cats = (draft.categories as AnyCat[] | undefined) ?? [];

  if (itemId === "meta") {
    return { kind: "minCredits", minCredits: Number(draft.minCredits), citation: cit(draft.minCreditsCitation as Cit) };
  }
  if (kind === "category") {
    const cat = cats.find((c) => c.id === ref);
    if (!cat) return null;
    const m = cat.match;
    const titles = titlesOf(draft);
    return {
      kind: "category",
      matchType: m.type as Extract<Editable, { kind: "category" }>["matchType"],
      credits: cat.credits,
      courses: m.type === "courseList" ? (m.codes as string[]).map((code) => ({ code, title: titles[code] ?? "" })) : undefined,
      names: m.type === "courseNames" ? (m.names as string[]) : undefined,
      prefixes: m.type === "courseNames" ? ((m.prefixes as string[] | undefined) ?? []) : undefined,
      excludeNames: m.type === "deptElective" ? ((m.excludeNames as string[] | undefined) ?? []) : undefined,
      citation: cit(cat.citation),
    };
  }
  if (kind === "subRule") {
    for (const cat of cats) {
      const s = cat.subRules?.find((x) => x.id === ref);
      if (s?.type === "domainCoverage") {
        return {
          kind: "domainCoverage",
          domains: s.domains as string[],
          minCreditsPerDomain: (s.minCreditsPerDomain as number | undefined) ?? null,
          citation: cit(s.citation),
        };
      }
    }
    return null;
  }
  if (kind === "check") {
    const g = ((draft.graduationChecks as AnyCheck[] | undefined) ?? []).find((x) => x.id === ref);
    if (!g) return null;
    return {
      kind: "check",
      name: g.name,
      rule: g.rule as "evidence" | "deptDefined" | "passedCourse",
      courseNames: (g.courseNames as string[] | undefined) ?? [],
      minTerms: (g.minTerms as number | undefined) ?? 1,
      citation: cit(g.citation),
    };
  }
  if (kind === "overflow") {
    const v = (draft.overflowPolicy as Record<string, { countsToTotal: boolean; citation: Cit }> | undefined)?.[ref];
    return v ? { kind: "overflow", countsToTotal: v.countsToTotal, citation: cit(v.citation) } : null;
  }
  if (kind === "termLimits") {
    const t = draft.termLimits as
      | {
          minCredits: number;
          maxCredits: number;
          byStudyYear?: { fromYear: number; minCredits?: number; maxCredits?: number }[];
          citations?: Cit[];
        }
      | undefined;
    if (!t) return null;
    return {
      kind: "termLimits",
      minCredits: t.minCredits,
      maxCredits: t.maxCredits,
      byStudyYear: t.byStudyYear ?? [],
      citation: cit(t.citations?.[Number(ref)]),
    };
  }
  return null;
}

function splitId(itemId: string): [string, string] {
  const i = itemId.indexOf(":");
  return i < 0 ? [itemId, ""] : [itemId.slice(0, i), itemId.slice(i + 1)];
}

// ------------------------------------------------------------ 套用

export type EditOptions = {
  /** 改了某一類的學分時，一併把「其他選修」調成「畢業最低學分 − 其他各類」，維持加總。要明確勾選才做 */
  rebalanceFree?: boolean;
};

/**
 * 套用修改並驗證。成功回傳新草稿與人看得懂的變更清單；失敗丟 EditError，內含每一條問題。
 * 純函式：不讀寫任何儲存，方便測試。
 */
export function applyEdit(
  draft: Draft,
  corpus: Map<string, string>,
  itemId: string,
  input: unknown,
  opts: EditOptions = {},
): { draft: Draft; changes: string[] } {
  const parsed = zEditable.safeParse(input);
  if (!parsed.success) throw new EditError(parsed.error.issues.map((i) => i.message));
  const next = parsed.data;
  const before = editableOf(draft, itemId);
  if (!before) throw new EditError(["這一項不能直接修改，請用「留言給維護者」"]);
  if (before.kind !== next.kind) throw new EditError(["修改的類型與項目不符"]);

  const out = structuredClone(draft) as Draft;
  const changes: string[] = [];
  const [kind, ref] = splitId(itemId);
  const note = (label: string, a: unknown, b: unknown) => {
    const fmt = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join("、") : "（無）") : String(v ?? "（無）"));
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push(`${label}：${fmt(a)} → ${fmt(b)}`);
  };
  const setCitation = (target: { citation?: Cit }, c: EditCitation, oldC: EditCitation) => {
    note("依據原文", oldC.quote, c.quote);
    note("原文位置", oldC.locator, c.locator);
    note("依據文件", oldC.docId, c.docId);
    target.citation = { docId: c.docId, locator: c.locator, quote: c.quote };
  };
  const problems: string[] = [];
  /** 改了數字，依據的原文裡要找得到；不然就是改了值卻沒換依據 */
  const mustQuote = (label: string, value: number, ...quotes: string[]) => {
    if (!quotes.some((q) => numberValuesOf(q).includes(value))) {
      problems.push(`${label}改成 ${value}，但依據的原文裡沒有 ${value}。請換成寫著 ${value} 的那句原文`);
    }
  };

  const cats = out.categories as AnyCat[];

  switch (next.kind) {
    case "minCredits": {
      const b = before as Extract<Editable, { kind: "minCredits" }>;
      note("畢業最低學分", b.minCredits, next.minCredits);
      out.minCredits = next.minCredits;
      const holder: { citation?: Cit } = {};
      setCitation(holder, next.citation, b.citation);
      out.minCreditsCitation = holder.citation;
      mustQuote("畢業最低學分", next.minCredits, next.citation.quote);
      break;
    }
    case "category": {
      const b = before as Extract<Editable, { kind: "category" }>;
      const cat = cats.find((c) => c.id === ref)!;
      if (next.matchType !== b.matchType) problems.push("不能改這一類的比對方式，請留言給維護者");
      note("學分", b.credits, next.credits);
      cat.credits = next.credits;
      if (b.matchType !== "anyPassed" && next.credits !== b.credits) mustQuote("學分", next.credits, next.citation.quote);

      if (b.matchType === "courseList" && next.courses) {
        const codes = next.courses.map((c) => c.code);
        note("課程", b.courses!.map((c) => `${c.title} ${c.code}`), next.courses.map((c) => `${c.title} ${c.code}`));
        if (codes.length === 0) problems.push("課程清單不能是空的");
        if (new Set(codes).size !== codes.length) problems.push("課程清單有重複的課號");
        cat.match = { ...cat.match, codes };
        const meta = (out._draft ??= {}) as { courseTitles?: Record<string, string> };
        meta.courseTitles = { ...(meta.courseTitles ?? {}) };
        for (const c of next.courses) if (c.title) meta.courseTitles[c.code] = c.title;
      }
      if (b.matchType === "courseNames") {
        note("課名", b.names, next.names ?? []);
        note("課名開頭", b.prefixes, next.prefixes ?? []);
        const prefixes = next.prefixes ?? [];
        cat.match = { ...cat.match, names: next.names ?? [], ...(prefixes.length ? { prefixes } : {}) };
        if (!prefixes.length) delete cat.match.prefixes;
      }
      if (b.matchType === "deptElective") {
        note("不算在內的課", b.excludeNames, next.excludeNames ?? []);
        const ex = next.excludeNames ?? [];
        cat.match = { ...cat.match, excludeNames: ex };
        if (!ex.length) delete cat.match.excludeNames;
      }
      setCitation(cat, next.citation, b.citation);

      if (opts.rebalanceFree && next.credits !== b.credits) {
        const free = cats.find((c) => c.match.type === "anyPassed" && c.id !== cat.id);
        if (free) {
          const others = cats.filter((c) => c !== free).reduce((a, c) => a + c.credits, 0);
          const value = Number(out.minCredits) - others;
          note(`「${free.name}」學分（自動調整）`, free.credits, value);
          free.credits = value;
          if (value < 0) problems.push(`其他各類加起來已超過畢業最低學分 ${out.minCredits}`);
        }
      }
      break;
    }
    case "domainCoverage": {
      const b = before as Extract<Editable, { kind: "domainCoverage" }>;
      const s = cats.flatMap((c) => c.subRules ?? []).find((x) => x.id === ref)!;
      note("領域", b.domains, next.domains);
      note("每領域至少學分", b.minCreditsPerDomain, next.minCreditsPerDomain);
      s.domains = next.domains;
      if (next.minCreditsPerDomain === null) delete s.minCreditsPerDomain;
      else s.minCreditsPerDomain = next.minCreditsPerDomain;
      setCitation(s, next.citation, b.citation);
      if (next.minCreditsPerDomain !== null && next.minCreditsPerDomain !== b.minCreditsPerDomain) {
        mustQuote("每領域至少學分", next.minCreditsPerDomain, next.citation.quote);
      }
      break;
    }
    case "check": {
      const b = before as Extract<Editable, { kind: "check" }>;
      const g = (out.graduationChecks as AnyCheck[]).find((x) => x.id === ref)!;
      note("名稱", b.name, next.name);
      note("判斷方式", RULE_LABEL[b.rule], RULE_LABEL[next.rule]);
      g.name = next.name;
      g.rule = next.rule;
      if (next.rule === "passedCourse") {
        note("成績單上的課名", b.courseNames, next.courseNames);
        note("至少幾學期", b.minTerms, next.minTerms);
        if (next.courseNames.length === 0) problems.push("「看成績單上的課名」要填至少一個課名");
        g.courseNames = next.courseNames;
        if (next.minTerms > 1) g.minTerms = next.minTerms;
        else delete g.minTerms;
      } else {
        delete g.courseNames;
        delete g.minTerms;
      }
      setCitation(g, next.citation, b.citation);
      break;
    }
    case "overflow": {
      const b = before as Extract<Editable, { kind: "overflow" }>;
      const v = (out.overflowPolicy as Record<string, { countsToTotal: boolean; citation?: Cit }>)[ref]!;
      note("修超過的學分算進畢業學分", b.countsToTotal ? "算" : "不算", next.countsToTotal ? "算" : "不算");
      v.countsToTotal = next.countsToTotal;
      setCitation(v, next.citation, b.citation);
      break;
    }
    case "termLimits": {
      const b = before as Extract<Editable, { kind: "termLimits" }>;
      const t = out.termLimits as { minCredits: number; maxCredits: number; byStudyYear?: unknown[]; citations: Cit[] };
      const fmtYears = (ys: Extract<Editable, { kind: "termLimits" }>["byStudyYear"]) =>
        ys.map((y) => `第 ${y.fromYear} 學年起 ${y.minCredits ?? "-"}～${y.maxCredits ?? "-"}`);
      note("每學期最少", b.minCredits, next.minCredits);
      note("每學期最多", b.maxCredits, next.maxCredits);
      note("依學年調整", fmtYears(b.byStudyYear), fmtYears(next.byStudyYear));
      t.minCredits = next.minCredits;
      t.maxCredits = next.maxCredits;
      t.byStudyYear = next.byStudyYear;
      const holder: { citation?: Cit } = {};
      setCitation(holder, next.citation, b.citation);
      t.citations = t.citations.map((c, i) => (i === Number(ref) ? holder.citation! : c));
      // 每學期學分的數字分散在幾段原文裡，數字在任一段找得到就行
      const quotes = t.citations.map((c) => c.quote ?? "");
      const nums = [
        next.minCredits,
        next.maxCredits,
        ...next.byStudyYear.flatMap((y) => [y.minCredits, y.maxCredits].filter((n): n is number => n !== undefined)),
      ];
      const old = new Set([b.minCredits, b.maxCredits, ...b.byStudyYear.flatMap((y) => [y.minCredits, y.maxCredits])]);
      for (const n of nums) if (!old.has(n)) mustQuote("學分上下限", n, ...quotes);
      break;
    }
  }

  // 規則包整體要仍然成立：schema（含學分加總）＋與上傳草稿相同的自動驗證
  const pack = zRulePack.safeParse(out);
  if (!pack.success) problems.push(...pack.error.issues.map((i) => i.message));
  else problems.push(...validatePack(pack.data, corpus).filter((i) => i.level === "error").map((i) => i.message));

  if (problems.length) throw new EditError(problems);
  if (changes.length === 0) throw new EditError(["沒有改到任何東西"]);
  return { draft: out, changes };
}

const RULE_LABEL: Record<string, string> = {
  evidence: "請學生自行確認",
  deptDefined: "由系上另訂",
  passedCourse: "看成績單上的課名",
};
