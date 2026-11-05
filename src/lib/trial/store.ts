import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/store/paths";
import { supabaseClient, supabaseConfigured } from "@/lib/store/supabase";
import { emptyMod, type TrialMod, type TrialSession } from "./session";

/**
 * 試用紀錄存在非公開儲存區，一人一份 JSON，不新增資料表：
 * 人數最多十幾位，決賽後整批刪除（scripts/trial-purge.ts）。
 * AIDIT_TRIAL_LOCAL=1 時改存本機，開發測試才不會寫進正式資料。
 */

const BUCKET = "rulepack-uploads";
const PREFIX = "_trial";
const ID_RE = /^[0-9a-f]{32}$/;

const useFiles = () => !supabaseConfigured() || process.env.AIDIT_TRIAL_LOCAL === "1";
const localDir = () => dataDir("trial");

async function put(name: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value);
  if (useFiles()) {
    mkdirSync(localDir(), { recursive: true });
    writeFileSync(join(localDir(), name), body);
    return;
  }
  const { error } = await (await supabaseClient())
    .storage.from(BUCKET)
    .upload(`${PREFIX}/${name}`, new Blob([body], { type: "application/json" }), { upsert: true, cacheControl: "0" });
  if (error) throw new Error(`寫入試用紀錄失敗：${error.message}`);
}

async function get<T>(name: string): Promise<T | null> {
  if (useFiles()) {
    const p = join(localDir(), name);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
  }
  const { data, error } = await (await supabaseClient()).storage.from(BUCKET).download(`${PREFIX}/${name}`);
  if (error || !data) return null;
  return JSON.parse(await data.text()) as T;
}

async function listNames(): Promise<string[]> {
  if (useFiles()) return existsSync(localDir()) ? readdirSync(localDir()) : [];
  const { data, error } = await (await supabaseClient()).storage.from(BUCKET).list(PREFIX, { limit: 1000 });
  if (error) throw new Error(`讀取試用紀錄失敗：${error.message}`);
  return (data ?? []).map((f) => f.name);
}

export const isTrialId = (id: string) => ID_RE.test(id);

export const saveSession = (s: TrialSession) => put(`${s.id}.json`, s);
export const loadSession = (id: string) => (isTrialId(id) ? get<TrialSession>(`${id}.json`) : Promise.resolve(null));
export const saveMod = (id: string, m: TrialMod) => put(`${id}.mod.json`, m);
export const loadMod = async (id: string) => (await get<TrialMod>(`${id}.mod.json`)) ?? emptyMod();

export async function listSessions(): Promise<{ session: TrialSession; mod: TrialMod }[]> {
  const ids = (await listNames()).filter((n) => /^[0-9a-f]{32}\.json$/.test(n)).map((n) => n.slice(0, 32));
  const rows = await Promise.all(
    ids.map(async (id) => {
      const session = await loadSession(id);
      return session ? { session, mod: await loadMod(id) } : null;
    }),
  );
  return rows.filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => a.session.createdAt - b.session.createdAt);
}

/** 刪除一位受試者的紀錄與主持人判定 */
export async function deleteSession(id: string): Promise<void> {
  if (!isTrialId(id)) throw new Error("不合法的代號");
  const names = [`${id}.json`, `${id}.mod.json`];
  if (useFiles()) {
    for (const n of names) rmSync(join(localDir(), n), { force: true });
    return;
  }
  const { error } = await (await supabaseClient()).storage.from(BUCKET).remove(names.map((n) => `${PREFIX}/${n}`));
  if (error) throw new Error(`刪除試用紀錄失敗：${error.message}`);
}

/** 刪除全部試用的原始紀錄，回傳刪了幾個檔案 */
export async function purgeAllTrials(): Promise<number> {
  const names = await listNames();
  if (useFiles()) {
    for (const n of names) rmSync(join(localDir(), n), { force: true });
    return names.length;
  }
  if (names.length === 0) return 0;
  const { error } = await (await supabaseClient()).storage.from(BUCKET).remove(names.map((n) => `${PREFIX}/${n}`));
  if (error) throw new Error(`刪除試用紀錄失敗：${error.message}`);
  return names.length;
}
