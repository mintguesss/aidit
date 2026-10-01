import { runAudit, type RunOutcome } from "@/lib/agent/runner";
import { traceStore } from "@/lib/store";
import { resolveRulePack, preloadPublishedRules } from "@/lib/rules/loader";
import { constraintsFrom, describeConstraints } from "@/lib/solver/schedule";
import { preferencesOf } from "@/lib/chat/apply";
import { purgeDaily } from "@/lib/store/purge";
import type { FixtureId } from "@/lib/providers/fixtures";
import type { CoursePreferences } from "@/lib/types";
import { termLimitsFor } from "@/lib/rules/term-limits";

/**
 * 審查結果快取（docs/BACKEND.md §8）。
 *
 * 拆成多頁之後，每換一個分頁都重跑一次 agent 是不對的：
 *   1. traceId 會變，情境試算與選課微調就找不到同一份審查結果；
 *   2. 同一份資料在同一段時間內應該得到同一個答案，這是可溯源的前提。
 *
 * 因此以 (fixture, term) 為 key 快取 10 分鐘，與 docs/BACKEND.md §8 的
 * 「key = hash(studentRecord) + rulePackVersion、TTL 10 分鐘」同一個意思。
 */

const TTL_MS = 10 * 60 * 1000;

export type AuditSession = {
  outcome: RunOutcome;
  /** 下列欄位在成功時才有值 */
  termLimits: { maxCredits: number; minCredits: number };
  preferences: CoursePreferences;
  appliedConstraints: string[];
};

const cache = new Map<string, { at: number; value: AuditSession }>();

export async function getAuditSession(fixture: FixtureId, currentTerm: string): Promise<AuditSession> {
  // 保留政策要真的被執行才算數；每日一次，失敗不影響審查
  void purgeDaily();

  // 已發布的規則包在這裡載入記憶體，之後 loadRulePacks()／loadCorpus() 維持同步。
  // 放在這個入口是因為它是所有審查的必經之路，而且已經是 async。
  await preloadPublishedRules();

  const key = `${fixture}:${currentTerm}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const outcome = await runAudit({ providerKind: "mock", fixture, currentTerm });
  const store = traceStore();
  await store.saveTrace(outcome.trace).catch(() => undefined);

  let termLimits = { maxCredits: 25, minCredits: 9 };
  let preferences = preferencesOf(undefined);

  if (outcome.ok) {
    const record = outcome.state.record!;
    const pack = resolveRulePack(record.student);
    // 用排課那個學期的學年算（大三下替大四上排課，用的是大四的上下限）
    if (pack.ok) termLimits = termLimitsFor(pack.pack, record.student, outcome.audit.nextTerm);
    preferences = preferencesOf(record.preferences);
  }

  const value: AuditSession = {
    outcome,
    termLimits,
    preferences,
    appliedConstraints: describeConstraints(constraintsFrom(preferences, termLimits), preferences),
  };

  // 清掉過期項目，避免長時間執行的 dev server 一直長大
  for (const [k, v] of cache) if (Date.now() - v.at >= TTL_MS) cache.delete(k);
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function __clearAuditCache(): void {
  cache.clear();
}
