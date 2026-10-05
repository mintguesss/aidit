import { DEFAULT_PREFERENCES, type CoursePreferences, type ExtraGoal } from "@/lib/types";

/**
 * 偏好在瀏覽器端的快取。
 *
 * **權威來源是伺服器**（docs/SPEC-CHANGES.md E60、[ui/sync.ts](./sync.ts)）；
 * 這裡是離線備援 —— 連不上伺服器時回退本機值，不中斷流程。
 *
 * 為什麼不是只放這裡：查閱／刪除／匯出這一整套是**資料主體權利**的形狀，
 * 而那些權利之所以存在，正是因為資料在別人手上。蓋在 localStorage 上，
 * 使用者本來就能從瀏覽器設定清掉，那個按鈕只是比較好按而已，不是一項權利。
 * §E58 原本規定只存本地，被 §E60 推翻，理由見該條。
 *
 * docs/SPEC.md §9 管的是修課紀錄不落地與 trace 去識別，沒有規範偏好；
 * 偏好的保留期限、自動刪除與刪除權由 §E58／§E60 補上。
 *
 * **必填與選填分開存放**（`required` / `optional`）。
 * 這不只是為了畫面上好標示 —— 分開存，「只刪選填」才可能是一個乾淨的動作：
 * 刪掉 optional 整個鍵即可，不必逐欄挑，也不會誤刪到規劃所需的欄位。
 * 兩者的性質也不同：
 *   required 少一項，課表就排不出來或排錯
 *   optional 少一項，只是排序換個順序，任何判定都不會變
 */

export type OptionalPreferences = {
  /** 職涯方向，例如「資料分析」 */
  careerDirection?: string;
  /** 興趣領域 */
  interestAreas: string[];
  /** 想避開的課程類型，例如「大量程式作業」 */
  avoidCourseTypes: string[];
};

export const EMPTY_OPTIONAL: OptionalPreferences = {
  interestAreas: [],
  avoidCourseTypes: [],
};

export type StoredPreferences = {
  required: CoursePreferences;
  optional: OptionalPreferences;
  /** 最後一次使用的時間；12 個月未使用即自動刪除 */
  lastUsedAt: string;
};

const KEY = "aidit.preferences";
/** 最後使用日起算多久沒再用就自動刪除 */
export const PREF_TTL_MONTHS = 12;

// ------------------------------------------------------------ 讀寫

export function loadStored(fallback: CoursePreferences): StoredPreferences {
  const empty: StoredPreferences = {
    required: fallback,
    optional: EMPTY_OPTIONAL,
    lastUsedAt: new Date().toISOString(),
  };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<StoredPreferences> & Partial<CoursePreferences>;

    // 舊版是扁平的 CoursePreferences，直接當成 required 收下
    const required =
      parsed.required && typeof parsed.required === "object"
        ? { ...fallback, ...parsed.required }
        : { ...fallback, ...(parsed as Partial<CoursePreferences>) };

    const stored: StoredPreferences = {
      required: normalise(required),
      optional: normaliseOptional(parsed.optional),
      lastUsedAt:
        typeof parsed.lastUsedAt === "string" ? parsed.lastUsedAt : new Date().toISOString(),
    };

    if (isExpired(stored.lastUsedAt)) {
      clearAll();
      return empty;
    }
    return stored;
  } catch {
    // 私密視窗、被清掉、或使用者關閉了站台資料 —— 一律回退到預設，不中斷流程
    return empty;
  }
}

/** 相容舊呼叫點：只要必填的部分 */
export function loadPreferences(fallback: CoursePreferences): CoursePreferences {
  return loadStored(fallback).required;
}

export function loadOptional(): OptionalPreferences {
  return loadStored(DEFAULT_PREFERENCES).optional;
}

export function savePreferences(p: CoursePreferences, optional?: OptionalPreferences): boolean {
  if (typeof window === "undefined") return false;
  try {
    const current = loadStored(p);
    const next: StoredPreferences = {
      required: normalise(p),
      optional: normaliseOptional(optional ?? current.optional),
      lastUsedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** 只清除選填 —— 必填保留，系統仍可正常使用 */
export function clearOptional(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return true;
    const cur = JSON.parse(raw) as StoredPreferences;
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...cur, optional: EMPTY_OPTIONAL, lastUsedAt: new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

/** 清除全部偏好 */
export function clearAll(): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

/** 相容舊呼叫點 */
export const clearPreferences = clearAll;

/** 匯出成可下載的 JSON —— 使用者要看得到系統到底存了什麼 */
export function exportJson(fallback: CoursePreferences): string {
  const s = loadStored(fallback);
  return JSON.stringify(
    {
      note: "本檔為 Aidit 存在你瀏覽器裡的全部偏好。伺服器不持有這份資料。",
      exportedAt: new Date().toISOString(),
      ...s,
    },
    null,
    2,
  );
}

// ------------------------------------------------------------ 自動過期

export function isExpired(lastUsedAt: string): boolean {
  const t = Date.parse(lastUsedAt);
  if (!Number.isFinite(t)) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - PREF_TTL_MONTHS);
  return t < cutoff.getTime();
}

/**
 * 學籍狀態變更為畢業或離校即刪除。
 *
 * 這一條與 12 個月未使用不同：畢業之後偏好再也不會被用到，
 * 留著只是多一份沒有人會管理的個資。
 */
export function purgeIfLeft(status: string | undefined): boolean {
  if (status === "graduated" || status === "leave") return clearAll();
  return false;
}

// ------------------------------------------------------------ 防呆

/** 防止外部塞進非法值：必填會直接進入求解器的條件 */
function normalise(p: CoursePreferences): CoursePreferences {
  const goal = ["asap", "balanced", "light"].includes(p.goal) ? p.goal : DEFAULT_PREFERENCES.goal;
  const days = Array.isArray(p.avoidDays)
    ? [...new Set(p.avoidDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b)
    : [];
  const clamp = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;

  return {
    goal,
    avoidEarly: Boolean(p.avoidEarly),
    avoidDays: days,
    maxCredits: clamp(p.maxCredits, 0, 30),
    targetCourseCount: clamp(p.targetCourseCount, 0, 30),
    preferCompactDays: Boolean(p.preferCompactDays),
    note: typeof p.note === "string" ? p.note.slice(0, 200) : undefined,
    extraGoals: normaliseGoals(p.extraGoals),
  };
}

/** 選填只影響排序，但一樣要防呆 —— 它會被寫進 prompt 與排序鍵 */
function normaliseOptional(v: unknown): OptionalPreferences {
  const o = (v ?? {}) as Partial<OptionalPreferences>;
  const list = (x: unknown) =>
    Array.isArray(x)
      ? [...new Set(x.filter((s): s is string => typeof s === "string" && s.trim() !== ""))]
          .map((s) => s.trim().slice(0, 20))
          .slice(0, 8)
      : [];
  return {
    careerDirection:
      typeof o.careerDirection === "string" && o.careerDirection.trim() !== ""
        ? o.careerDirection.trim().slice(0, 30)
        : undefined,
    interestAreas: list(o.interestAreas),
    avoidCourseTypes: list(o.avoidCourseTypes),
  };
}

const EXTRA_KINDS = ["minor", "double-major", "cert-program", "transfer"] as const;

/** 額外修業目標同樣要防呆：它會決定畫面上提醒什麼，不該讓非法值進來 */
function normaliseGoals(v: unknown): ExtraGoal[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((g): g is ExtraGoal =>
      Boolean(g) &&
      typeof g === "object" &&
      EXTRA_KINDS.includes((g as ExtraGoal).kind) &&
      typeof (g as ExtraGoal).target === "string" &&
      (g as ExtraGoal).target.trim().length > 0,
    )
    .map((g) => ({ kind: g.kind, target: g.target.trim().slice(0, 20) }))
    .slice(0, 4);
}
