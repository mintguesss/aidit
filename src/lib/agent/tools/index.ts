import type { AuditResult, Citation, Offering, Preset, SolveResult, Term } from "@/lib/types";
import { createProvider } from "@/lib/providers";
import type { Capabilities } from "@/lib/providers";
import type { ProviderKind, StudentRecord } from "@/lib/types";
import type { FixtureId } from "@/lib/providers/fixtures";
import { auditCredits, type AuditInput } from "@/lib/audit/engine";
import { verifyAll, type VerifyReport } from "@/lib/verify/citation";
import { loadCorpus } from "@/lib/rules/loader";
import { offeringsFor } from "@/lib/offerings";
import { solveWithRelaxation, type SolveContext } from "@/lib/solver/schedule";
import { scanMany } from "@/lib/safety/scan";

export * from "./rule";
export * from "./web";

/** record.fetch —— 走 Provider 介面，上層不知道拿到的是哪一種來源 */
export async function recordFetch(
  kind: ProviderKind,
  payload: unknown,
  fixture?: FixtureId,
): Promise<{ record: StudentRecord; capabilities: Capabilities }> {
  const provider = createProvider(kind, { fixture });
  const record = await provider.fetch(payload ?? (fixture ? { fixture } : undefined));
  return { record, capabilities: provider.capabilities() };
}

/** credit.audit —— 純程式。本函式與其相依模組不得出現任何 LLM 呼叫 */
export function creditAudit(input: AuditInput): AuditResult {
  return auditCredits(input);
}

/** citation.verify —— 字串比對原文，不經 LLM */
export function citationVerify(citations: Citation[]): VerifyReport {
  return verifyAll(citations, loadCorpus());
}

/** 蒐集審查結果中所有出現在使用者面前的引用 */
export function collectCitations(audit: AuditResult): Citation[] {
  const out: Citation[] = [];
  for (const c of audit.categories) {
    out.push(...c.citations);
    for (const s of c.subRules) out.push(...s.citations);
  }
  for (const g of audit.graduationChecks) out.push(...g.citations);
  for (const h of audit.holds) out.push(...h.citations);
  return out;
}

/** course.search —— 查自建開課資料庫 */
export function courseSearch(year: number, term: Term, categories: string[]): Offering[] {
  const wanted = new Set(categories);
  return offeringsFor(year, term).filter((o) => o.category.some((c) => wanted.has(c)));
}

/** schedule.solve —— backtracking，不經 LLM */
export function scheduleSolve(ctx: SolveContext, preset: Preset): SolveResult {
  return solveWithRelaxation(ctx, preset, []);
}

/** safety.scan —— 外部內容注入檢查 */
export function safetyScan(items: { text: string; sourceUrl: string }[]) {
  return scanMany(items);
}
