import { loadRulePacks, loadCorpus } from "./loader";
import { loadExtraPacks, extraCorpus } from "./extra-packs";
import { PROGRAM_CLAUSES, PROGRAM_DOCS, PROGRAM_EXTRA_DOCS } from "./program-regs";
import { ANNOUNCEMENTS } from "./announcements";
import { anchorOf, shortTitleOf } from "./anchor";

/**
 * 原文出處總表。
 *
 * 先前每一條結論旁邊都直接印出引文、出處與下載連結。那在「可查核」上是對的，
 * 但同一份文件的同一段話會在畫面上出現很多次，每一格都變得很擠，
 * 反而沒有人真的去讀那段原文。
 *
 * 改成：所有被引用的原文集中在一頁，每一段有固定的錨點；
 * 各處的結論只放一個短連結指過去。**依據沒有變少，只是換了一個地方放**，
 * 而且在那裡看得到同一份文件的前後文與其他條文，對查核反而更有用。
 */

export type SourcePassage = {
  /** 錨點 id，供 /sources#<id> 使用 */
  anchor: string;
  locator: string;
  quote: string;
  /** 這一段被哪些判定引用 */
  usedBy: string[];
};

export { anchorOf, shortTitleOf };

export type SourceDoc = {
  id: string;
  title: string;
  /** 畫面上用的短名，例如「課程規劃表」 */
  shortTitle: string;
  publishedAt?: string;
  kind: "plan" | "regulation" | "announcement" | "extra";
  provenance?: string;
  hasCorpus: boolean;
  passages: SourcePassage[];
  /** 哪一所學校、哪一系的文件。沒填＝不分（原文出處頁依學生篩選，見 sourcesFor） */
  school?: string;
  dept?: string;
};

type Raw = { docId: string; locator: string; quote?: string; usedBy: string };

/** 走訪任意物件，撈出所有 citation 形狀的節點 */
function walk(v: unknown, label: string, out: Raw[]): void {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) walk(x, label, out);
    return;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.docId === "string" && typeof o.locator === "string") {
    out.push({
      docId: o.docId,
      locator: o.locator,
      quote: typeof o.quote === "string" ? o.quote : undefined,
      usedBy: label,
    });
  }
  for (const [k, x] of Object.entries(o)) {
    if (k === "citation" || k === "citations") {
      walk(x, label, out);
      continue;
    }
    const next =
      typeof o.name === "string" ? o.name : typeof o.label === "string" ? o.label : label;
    walk(x, next, out);
  }
}

let cache: SourceDoc[] | null = null;

/**
 * 這位學生看得到的文件：同一所學校，系所不限或是他的系。
 * 輔大資管的學生不該在原文出處看到合成學校或物理系的文件
 */
export function sourcesFor(school: string, dept: string): SourceDoc[] {
  return allSources().filter((d) => (!d.school || d.school === school) && (!d.dept || d.dept === dept));
}

export function allSources(): SourceDoc[] {
  if (cache) return cache;

  const raws: Raw[] = [];
  const docs = new Map<string, SourceDoc>();

  const put = (d: Omit<SourceDoc, "passages">) => {
    if (!docs.has(d.id)) docs.set(d.id, { ...d, passages: [] });
  };

  const corpus = loadCorpus();
  for (const pack of loadRulePacks()) {
    for (const doc of pack.documents) {
      put({
        id: doc.id,
        title: doc.title,
        shortTitle: shortTitleOf(doc.title),
        publishedAt: doc.publishedAt,
        kind: /(?:^|-)plan(?:-|$)/.test(doc.id) ? "plan" : "regulation",
        provenance: pack.provenance,
        hasCorpus: corpus.has(doc.id),
        school: pack.school ?? "demo",
        dept: pack.dept,
      });
    }
    walk(pack, pack.dept, raws);
  }

  const extra = extraCorpus();
  for (const p of loadExtraPacks()) {
    put({
      id: p.document.id,
      title: p.document.title,
      shortTitle: shortTitleOf(p.document.title),
      publishedAt: p.document.publishedAt,
      kind: "extra",
      provenance: p.provenance,
      hasCorpus: extra.has(p.document.id),
      school: p.school ?? "demo",
    });
    // 雙主修、學程引用的是別系的文件（資管學生試算物理系雙主修，引的是物理系科目表）：不限系所
    const doc = docs.get(p.document.id);
    if (doc) doc.dept = undefined;
    walk(p, p.title, raws);
  }

  // 學校的雙主修、輔系辦法（rules/program-regs.ts）
  for (const [school, docsOf] of Object.entries(PROGRAM_DOCS)) {
    for (const d of Object.values(docsOf)) {
      put({
        id: d.docId,
        title: d.title,
        shortTitle: shortTitleOf(d.title),
        publishedAt: d.publishedAt,
        kind: "regulation",
        hasCorpus: corpus.has(d.docId),
        school,
      });
    }
    for (const d of PROGRAM_EXTRA_DOCS[school] ?? []) {
      put({ id: d.docId, title: d.title, shortTitle: shortTitleOf(d.title), publishedAt: d.publishedAt, kind: "regulation", hasCorpus: corpus.has(d.docId), school });
    }
    for (const c of PROGRAM_CLAUSES[school] ?? []) {
      raws.push({ docId: c.docId ?? docsOf[c.program].docId, locator: c.locator, quote: c.quote, usedBy: `${c.program}問答與試算` });
    }
  }

  for (const a of ANNOUNCEMENTS) {
    put({
      id: a.contentDocId,
      title: a.title,
      shortTitle: shortTitleOf(a.title),
      publishedAt: a.publishedAt,
      kind: "announcement",
      hasCorpus: corpus.has(a.contentDocId),
      school: a.school,
      dept: a.dept,
    });
    if (a.appliesToRaw) {
      raws.push({
        docId: a.contentDocId,
        locator: "第 1 點適用對象",
        quote: a.appliesToRaw,
        usedBy: "規則衝突解消",
      });
    }
  }

  for (const r of raws) {
    const doc = docs.get(r.docId);
    if (!doc) continue;
    const anchor = anchorOf(r.docId, r.locator);
    const hit = doc.passages.find((p) => p.anchor === anchor);
    if (hit) {
      if (!hit.usedBy.includes(r.usedBy)) hit.usedBy.push(r.usedBy);
      if (!hit.quote && r.quote) hit.quote = r.quote;
      continue;
    }
    doc.passages.push({ anchor, locator: r.locator, quote: r.quote ?? "", usedBy: [r.usedBy] });
  }

  cache = [...docs.values()].map((d) => ({
    ...d,
    passages: d.passages.sort((a, b) => a.locator.localeCompare(b.locator, "zh-Hant")),
  }));
  return cache;
}
