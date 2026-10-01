import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths";
import { supabaseClient, supabaseConfigured } from "./supabase";
import type { CoursePreferences, Declarations } from "@/lib/types";
import type { OptionalPreferences } from "@/lib/ui/prefs";

/**
 * 偏好的伺服器端儲存（docs/SPEC-CHANGES.md E60）。
 *
 * 為什麼不只放 localStorage：查閱／刪除／匯出這一整套是**資料主體權利**的形狀，
 * 而那些權利之所以存在，正是因為資料在別人手上。蓋在 localStorage 上，
 * 使用者本來就能從瀏覽器設定清掉 —— 那個「刪除」按鈕只是比較好按而已，不是一項權利。
 *
 * 所以偏好存在伺服器端，而「刪除」真的會刪到伺服器上的那一份。代價是這份資料
 * 從此需要被管理：以 `studentHash`（HMAC，不可逆）為鍵、必填與選填分開存、
 * 12 個月未使用或畢業離校即刪除、每日清理。
 *
 * `required` 內含 `extraGoals`（額外修業目標），兩者一起存、一起刪。
 *
 * 本模組只管偏好。修課紀錄由 Provider 每次讀取，不屬於這裡的管轄範圍。
 */

export type StoredServerPrefs = {
  required: CoursePreferences;
  optional: OptionalPreferences;
  lastUsedAt: string;
  /** 學籍狀態，供自動刪除判定用；不存任何可識別欄位 */
  status?: string;
  /**
   * 畢業條件的自行勾選（學校資料看不出來的那幾項）。跟偏好一起存、一起刪。
   * Supabase 上沒有獨立欄位（加欄位要跑遷移），存在 required 這個 jsonb 裡的 declarations 鍵，
   * 讀寫時在這一層拆開 —— 外面看到的就是獨立欄位
   */
  declarations?: Declarations;
};

/** 最後使用日起算多久沒再用就自動刪除 */
export const PREF_TTL_MONTHS = 12;

const EMPTY_OPTIONAL: OptionalPreferences = { interestAreas: [], avoidCourseTypes: [] };
const KEY_RE = /^[0-9a-f]{32}$/;

export function isExpired(lastUsedAt: string): boolean {
  const t = Date.parse(lastUsedAt);
  if (!Number.isFinite(t)) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - PREF_TTL_MONTHS);
  return t < cutoff.getTime();
}

function stale(v: StoredServerPrefs): boolean {
  return isExpired(v.lastUsedAt) || v.status === "graduated" || v.status === "leave";
}

export interface PrefsStore {
  readonly kind: "supabase" | "file";
  load(hash: string): Promise<StoredServerPrefs | null>;
  save(hash: string, v: StoredServerPrefs): Promise<boolean>;
  /** 只刪選填 —— 必填保留，系統仍可正常使用 */
  deleteOptional(hash: string): Promise<boolean>;
  delete(hash: string): Promise<boolean>;
  /** 每日清理：逾期與已離校的偏好一併刪除。回傳刪除筆數 */
  purgeExpired(): Promise<number>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

// ------------------------------------------------------------ 檔案替身

class FilePrefsStore implements PrefsStore {
  readonly kind = "file" as const;
  private dir = dataDir("prefs");

  private pathOf(hash: string): string | null {
    return KEY_RE.test(hash) ? join(this.dir, `${hash}.json`) : null;
  }

  async load(hash: string): Promise<StoredServerPrefs | null> {
    const p = this.pathOf(hash);
    if (!p || !existsSync(p)) return null;
    try {
      const v = JSON.parse(readFileSync(p, "utf8")) as StoredServerPrefs;
      if (stale(v)) {
        await this.delete(hash);
        return null;
      }
      return v;
    } catch {
      return null;
    }
  }

  async save(hash: string, v: StoredServerPrefs): Promise<boolean> {
    const p = this.pathOf(hash);
    if (!p) return false;
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      writeFileSync(p, JSON.stringify({ ...v, lastUsedAt: new Date().toISOString() }, null, 2), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  async deleteOptional(hash: string): Promise<boolean> {
    const cur = await this.load(hash);
    if (!cur) return true;
    return this.save(hash, { ...cur, optional: EMPTY_OPTIONAL });
  }

  async delete(hash: string): Promise<boolean> {
    const p = this.pathOf(hash);
    if (!p) return false;
    try {
      if (existsSync(p)) unlinkSync(p);
      return true;
    } catch {
      return false;
    }
  }

  async purgeExpired(): Promise<number> {
    if (!existsSync(this.dir)) return 0;
    let n = 0;
    for (const f of readdirSync(this.dir)) {
      const p = join(this.dir, f);
      try {
        const v = JSON.parse(readFileSync(p, "utf8")) as StoredServerPrefs;
        if (stale(v)) {
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

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      const probe = join(this.dir, ".health");
      writeFileSync(probe, "", "utf8");
      unlinkSync(probe);
      return { ok: true, detail: `可寫入 ${this.dir}` };
    } catch (e) {
      return { ok: false, detail: `${this.dir} 無法寫入：${String(e)}` };
    }
  }
}

// ------------------------------------------------------------ Supabase

type Row = {
  student_hash: string;
  required: CoursePreferences;
  optional: OptionalPreferences;
  last_used_at: string;
  status: string | null;
};

class SupabasePrefsStore implements PrefsStore {
  readonly kind = "supabase" as const;

  async load(hash: string): Promise<StoredServerPrefs | null> {
    if (!KEY_RE.test(hash)) return null;
    const db = await supabaseClient();
    const { data } = await db.from("preferences").select("*").eq("student_hash", hash).maybeSingle();
    if (!data) return null;

    const row = data as Row;
    const { declarations, ...required } = row.required as CoursePreferences & { declarations?: Declarations };
    const v: StoredServerPrefs = {
      required: required as CoursePreferences,
      optional: row.optional ?? EMPTY_OPTIONAL,
      lastUsedAt: row.last_used_at,
      status: row.status ?? undefined,
      ...(declarations ? { declarations } : {}),
    };
    if (stale(v)) {
      await this.delete(hash);
      return null;
    }
    return v;
  }

  async save(hash: string, v: StoredServerPrefs): Promise<boolean> {
    if (!KEY_RE.test(hash)) return false;
    const db = await supabaseClient();
    const { error } = await db.from("preferences").upsert({
      student_hash: hash,
      required: v.declarations ? { ...v.required, declarations: v.declarations } : v.required,
      optional: v.optional ?? EMPTY_OPTIONAL,
      last_used_at: new Date().toISOString(),
      status: v.status ?? null,
    });
    return !error;
  }

  async deleteOptional(hash: string): Promise<boolean> {
    const cur = await this.load(hash);
    if (!cur) return true;
    return this.save(hash, { ...cur, optional: EMPTY_OPTIONAL });
  }

  async delete(hash: string): Promise<boolean> {
    if (!KEY_RE.test(hash)) return false;
    const db = await supabaseClient();
    const { error } = await db.from("preferences").delete().eq("student_hash", hash);
    return !error;
  }

  async purgeExpired(): Promise<number> {
    const db = await supabaseClient();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - PREF_TTL_MONTHS);

    // 逾期
    const { count: a } = await db
      .from("preferences")
      .delete({ count: "exact" })
      .lt("last_used_at", cutoff.toISOString());
    // 畢業或離校 —— 與逾期是兩個獨立條件，不能合成一條 or 再漏掉其中一邊
    const { count: b } = await db
      .from("preferences")
      .delete({ count: "exact" })
      .in("status", ["graduated", "leave"]);

    return (a ?? 0) + (b ?? 0);
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const db = await supabaseClient();
      const { error } = await db.from("preferences").select("student_hash").limit(1);
      if (error) return { ok: false, detail: `查詢 preferences 失敗：${error.message}` };
      return { ok: true, detail: "preferences 可查詢" };
    } catch (e) {
      return { ok: false, detail: `連線失敗：${String(e)}` };
    }
  }
}

let store: PrefsStore | null = null;

export function prefsStore(): PrefsStore {
  if (!store) store = supabaseConfigured() ? new SupabasePrefsStore() : new FilePrefsStore();
  return store;
}
