import { zRulePack, COURSE_CODE_RE, type RulePack } from "./schema";
import { describeCourseCodeFormats } from "@/lib/courses/code";
import { contentHash } from "@/lib/util/identity";

/**
 * 上傳規則包的結構檢查。
 *
 * 這是「能不能進人工校對」的門檻，不是「能不能拿來判定」的門檻 ——
 * 後者還需要語料檔與逐條引用回查（docs/BACKEND.md §2），只有校對鎖版後才算數。
 * 這裡刻意不做模糊比對：上傳的檔案沒有語料就是沒有依據，說清楚比放行重要。
 */

export type PackIssue = { level: "error" | "warn"; message: string };

export type InspectResult =
  | {
      ok: true;
      issues: PackIssue[];
      summary: {
        id: string;
        version: string;
        admissionYear: number;
        dept: string;
        minCredits: number;
        categories: { id: string; label: string; credits: number }[];
        documents: { id: string; title: string; hasCorpus: boolean }[];
        ambiguities: number;
        provenance: string;
        contentHash: string;
      };
    }
  | { ok: false; issues: PackIssue[] };

export function inspectUploadedPack(raw: unknown): InspectResult {
  const parsed = zRulePack.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        level: "error" as const,
        message: `${i.path.join(".") || "(root)"}：${i.message}`,
      })),
    };
  }

  const pack: RulePack = parsed.data;
  const issues: PackIssue[] = [];
  const err = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warn", message });

  const sum = pack.categories.reduce((a, c) => a + c.credits, 0);
  if (sum !== pack.minCredits) err(`類別學分加總 ${sum} ≠ 畢業最低學分 ${pack.minCredits}`);

  const seen = new Map<string, string>();
  for (const cat of pack.categories) {
    if (cat.match.type !== "courseList") continue;
    for (const code of cat.match.codes) {
      if (!COURSE_CODE_RE.test(code)) err(`類別 ${cat.id} 的課號 ${code} 不符合任何已知課號格式（${describeCourseCodeFormats()}）`);
      const prev = seen.get(code);
      if (prev) err(`課號 ${code} 同時出現在 ${prev} 與 ${cat.id}`);
      seen.set(code, cat.id);
    }
  }

  let missingQuote = 0;
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.docId === "string" && typeof o.locator === "string" && !o.quote) missingQuote += 1;
    for (const x of Object.values(o)) walk(x);
  };
  walk(pack);
  if (missingQuote > 0) {
    err(`有 ${missingQuote} 條引用未留下原文 quote —— 沒有 quote 的欄位無法回查，等同於沒有依據`);
  }

  for (const doc of pack.documents) {
    if (!doc.corpusFile) warn(`文件「${doc.title}」未提供語料檔，其引用無法在本系統回查`);
  }
  if (pack.provenance === "approved") {
    warn("上傳檔案自稱已校對；本系統一律以未校對草稿處理，須經人工校對才會鎖版");
  }
  const ambiguityCount = pack.categories.reduce((a, c) => a + c.ambiguities.length, 0);
  if (ambiguityCount === 0) {
    warn("未記載任何 ambiguity。多數規劃表都有解釋空間，全無記載通常代表抽取時漏了附註");
  }

  if (issues.some((i) => i.level === "error")) return { ok: false, issues };

  return {
    ok: true,
    issues,
    summary: {
      id: pack.id,
      version: pack.version,
      admissionYear: pack.admissionYear,
      dept: pack.dept,
      minCredits: pack.minCredits,
      categories: pack.categories.map((c) => ({ id: c.id, label: c.name, credits: c.credits })),
      documents: pack.documents.map((d) => ({
        id: d.id,
        title: d.title,
        hasCorpus: Boolean(d.corpusFile),
      })),
      ambiguities: ambiguityCount,
      provenance: pack.provenance,
      contentHash: pack.contentHash ?? contentHash(raw),
    },
  };
}
