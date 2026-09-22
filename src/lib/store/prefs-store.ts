import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths";
import type { CoursePreferences } from "@/lib/types";
import type { OptionalPreferences } from "@/lib/ui/prefs";

/**
 * 偏好的伺服器端儲存。
 *
 * 為什麼不只放 localStorage：查閱／刪除／匯出這一整套是**資料主體權利**的形狀，
 * 而那些權利之所以存在，正是因為資料在別人手上。蓋在 localStorage 上，
 * 使用者本來就能從瀏覽器設定清掉 —— 那個「刪除」按鈕只是比較好按而已，不是一項權利。
 *
 * 所以偏好存在伺服器端，而「刪除」真的會刪到伺服器上的那一份。代價是這份資料
 * 從此需要被管理：以 `studentHash`（HMAC，不可逆）為鍵、必填與選填分開存、
 * 12 個月未使用或畢業離校即刪除、每日清理。
 *
 * 本模組只管偏好。修課紀錄由 Provider 每次讀取，不屬於這裡的管轄範圍。
 */

export type StoredServerPrefs = {
  required: CoursePreferences;
  optional: OptionalPreferences;
  lastUsedAt: string;
  /** 學籍狀態，供自動刪除判定用；不存任何可識別欄位 */
  status?: string;
};

/** 最後使用日起算多久沒再用就自動刪除 */
export const PREF_TTL_MONTHS = 12;

const DIR = dataDir("prefs");
const KEY_RE = /^[0-9a-f]{32}$/;

function pathOf(hash: string): string | null {
  return KEY_RE.test(hash) ? join(DIR, `${hash}.json`) : null;
}

export function loadPrefs(hash: string): StoredServerPrefs | null {
  const p = pathOf(hash);
  if (!p || !existsSync(p)) return null;
  try {
    const v = JSON.parse(readFileSync(p, "utf8")) as StoredServerPrefs;
    if (isExpired(v.lastUsedAt) || v.status === "graduated" || v.status === "leave") {
      deletePrefs(hash);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function savePrefs(hash: string, v: StoredServerPrefs): boolean {
  const p = pathOf(hash);
  if (!p) return false;
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    writeFileSync(p, JSON.stringify({ ...v, lastUsedAt: new Date().toISOString() }, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

/** 只刪選填 —— 必填保留，系統仍可正常使用 */
export function deleteOptional(hash: string): boolean {
  const cur = loadPrefs(hash);
  if (!cur) return true;
  return savePrefs(hash, {
    ...cur,
    optional: { interestAreas: [], avoidCourseTypes: [] },
  });
}

export function deletePrefs(hash: string): boolean {
  const p = pathOf(hash);
  if (!p) return false;
  try {
    if (existsSync(p)) unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isExpired(lastUsedAt: string): boolean {
  const t = Date.parse(lastUsedAt);
  if (!Number.isFinite(t)) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - PREF_TTL_MONTHS);
  return t < cutoff.getTime();
}

/** 每日清理：逾期與已離校的偏好一併刪除。回傳刪除筆數 */
export function purgeExpiredPrefs(): number {
  if (!existsSync(DIR)) return 0;
  let n = 0;
  for (const f of readdirSync(DIR)) {
    const p = join(DIR, f);
    try {
      const v = JSON.parse(readFileSync(p, "utf8")) as StoredServerPrefs;
      const stale = isExpired(v.lastUsedAt) || v.status === "graduated" || v.status === "leave";
      if (stale) {
        unlinkSync(p);
        n++;
      }
    } catch {
      // 壞掉的檔案留著也沒用，但刪之前先確認它真的過期了
      if (Date.now() - statSync(p).mtimeMs > PREF_TTL_MONTHS * 30 * 24 * 3600 * 1000) {
        unlinkSync(p);
        n++;
      }
    }
  }
  return n;
}
