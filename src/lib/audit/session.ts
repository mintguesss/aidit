import { runAudit, type RunOutcome } from "@/lib/agent/runner";
import { traceStore } from "@/lib/store";
import { resolveRulePack, preloadPublishedRules } from "@/lib/rules/loader";
import { constraintsFrom, describeConstraints } from "@/lib/solver/schedule";
import { preferencesOf } from "@/lib/chat/apply";
import { purgeDaily } from "@/lib/store/purge";
import { preloadOfferings } from "@/lib/offerings/published";
import type { FixtureId } from "@/lib/providers/fixtures";
import type { CoursePreferences } from "@/lib/types";
import { termLimitsFor } from "@/lib/rules/term-limits";
import { fixture as fixtureOf } from "@/lib/providers/fixtures";
import { prefsStore } from "@/lib/store/prefs-store";
import { studentHash } from "@/lib/util/identity";
import type { Declarations } from "@/lib/types";
import { unstable_cache, revalidateTag } from "next/cache";
import { fetchedAt } from "@/lib/offerings";
import { schoolOf } from "@/lib/schools";

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
  // 開課資料同理：資料庫裡的學期先載入記憶體，排課、搜尋維持同步呼叫
  await preloadOfferings();

  const key = `${fixture}:${currentTerm}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const declarations = await declarationsOf(fixture);
  const value = await sharedSession(fixture, currentTerm, declarations);

  // 清掉過期項目，避免長時間執行的 dev server 一直長大
  for (const [k, v] of cache) if (Date.now() - v.at >= TTL_MS) cache.delete(k);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * 跨執行個體共用的審查結果（Vercel 的資料快取）。
 *
 * 上面的記憶體快取只在同一個執行個體裡有效。Vercel 每一頁各自是一個函式，剛部署或閒置後
 * 每一頁第一次開都要重跑整份審查與排課（實測首頁、修業明細冷啟動 13 秒）。
 * 這裡讓第一個算完的結果給所有執行個體用。
 *
 * 鍵值包含會改變結果的每一樣東西：學生、學期、自行勾選、程式版本、規則包內容、開課資料時間 ——
 * 任何一樣變了就是新的鍵，不會拿到舊答案。結果是純 JSON（實測 390 KB，沒有 Set／Map）。
 * 不在 Next 的執行環境裡（單元測試、腳本）就直接算。
 */
async function sharedSession(fixture: FixtureId, currentTerm: string, declarations: Declarations | undefined): Promise<AuditSession> {
  const student = fixtureOf(fixture).record.student;
  const pack = resolveRulePack(student);
  const version = [
    process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    pack.ok ? (pack.pack.contentHash ?? pack.pack.version) : "no-pack",
    fetchedAt(schoolOf(student)),
    JSON.stringify(declarations ?? {}),
  ].join("|");
  try {
    return await unstable_cache(() => computeSession(fixture, currentTerm, declarations), ["audit-session", fixture, currentTerm, version], {
      revalidate: TTL_MS / 1000,
      tags: [`audit:${fixture}`],
    })();
  } catch (e) {
    if (!/incrementalCache|static generation store|outside of a request/i.test(String(e))) console.warn(`[aidit][session] 共用快取失敗，直接計算：${String(e)}`);
    return computeSession(fixture, currentTerm, declarations);
  }
}

async function computeSession(fixture: FixtureId, currentTerm: string, declarations: Declarations | undefined): Promise<AuditSession> {
  const outcome = await runAudit({ providerKind: "mock", fixture, currentTerm, declarations });
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

  return {
    outcome,
    termLimits,
    preferences,
    appliedConstraints: describeConstraints(constraintsFrom(preferences, termLimits), preferences),
  };
}

export function __clearAuditCache(): void {
  cache.clear();
}

/** 自行勾選改了之後，這位學生的審查結果要重算（所有學期） */
export function invalidateAuditSession(fixture: FixtureId): void {
  for (const k of cache.keys()) if (k.startsWith(`${fixture}:`)) cache.delete(k);
  // 共用快取的鍵值本來就含自行勾選，勾選一改就是新鍵；這裡再把舊的標成過期，免得留著佔空間
  try {
    revalidateTag(`audit:${fixture}`);
  } catch {
    // 不在 Next 的執行環境裡（測試）就算了
  }
}

/**
 * 學生對畢業條件的自行勾選，存在偏好儲存裡（以 studentHash 為鍵）。
 * 讀不到（沒設定、儲存層掛了）就當沒有勾 —— 不會因此擋住審查
 */
async function declarationsOf(fixture: FixtureId): Promise<Declarations | undefined> {
  try {
    const id = fixtureOf(fixture).record.student.id;
    return (await prefsStore().load(studentHash(id)))?.declarations;
  } catch {
    return undefined;
  }
}
