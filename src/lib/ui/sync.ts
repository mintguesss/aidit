import type { CoursePreferences } from "@/lib/types";
import { EMPTY_OPTIONAL, loadStored, savePreferences, clearAll, type OptionalPreferences } from "./prefs";

/**
 * 偏好的同步。
 *
 * **伺服器是權威來源**，localStorage 退為離線備援與快取。
 * 這樣「刪除」才是一項權利而不是裝飾 —— 純本地的話，使用者本來就能從瀏覽器設定清掉，
 * 那個按鈕只是比較好按而已。
 *
 * 換裝置、清瀏覽器資料之後偏好都還在，這也是實際會遇到的情況：
 * 手機填的設定，筆電上要看得到。
 *
 * 伺服器不可用時一律回退到本機值，不中斷流程 —— 排課本來就不需要伺服器記得你是誰。
 */

export type SyncedPreferences = {
  required: CoursePreferences;
  optional: OptionalPreferences;
  /** 這份值是從哪裡來的，畫面上要說得出來 */
  source: "server" | "local";
};

type ApiShape = {
  stored?: { required: CoursePreferences; optional: OptionalPreferences } | null;
};

export async function fetchPreferences(
  fixture: string,
  term: string,
  fallback: CoursePreferences,
): Promise<SyncedPreferences> {
  const local = loadStored(fallback);
  try {
    const r = await fetch("/api/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture, term }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const d = (await r.json()) as ApiShape;
    if (!d.stored) return { required: local.required, optional: local.optional, source: "local" };
    // 伺服器有值就以它為準，並回寫本機快取供離線使用
    savePreferences(d.stored.required, d.stored.optional);
    return {
      required: { ...fallback, ...d.stored.required },
      optional: { ...EMPTY_OPTIONAL, ...d.stored.optional },
      source: "server",
    };
  } catch {
    return { required: local.required, optional: local.optional, source: "local" };
  }
}

export async function pushPreferences(
  fixture: string,
  term: string,
  required: CoursePreferences,
  optional: OptionalPreferences,
): Promise<boolean> {
  savePreferences(required, optional);
  try {
    const r = await fetch("/api/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture, term, required, optional }),
    });
    return r.ok;
  } catch {
    // 本機已寫入，下次連得上時再同步；不讓離線變成「存不起來」
    return false;
  }
}

export type EraseScope = "optional" | "preferences" | "all";

export async function erase(
  fixture: string,
  term: string,
  scope: EraseScope,
): Promise<{ ok: boolean; traces: number }> {
  if (scope === "optional") {
    const cur = loadStored({} as CoursePreferences);
    savePreferences(cur.required, EMPTY_OPTIONAL);
  } else {
    clearAll();
  }
  try {
    const r = await fetch("/api/preferences", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture, term, scope }),
    });
    const d = (await r.json()) as { ok?: boolean; traces?: number };
    return { ok: Boolean(d.ok), traces: d.traces ?? 0 };
  } catch {
    return { ok: false, traces: 0 };
  }
}
