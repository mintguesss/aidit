import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/store/paths";
import { supabaseClient, supabaseConfigured } from "@/lib/store/supabase";

/**
 * 規則包草稿（docs/BACKEND.md §2）。
 *
 * 草稿由 `scripts/extract-rulepack.ts` 產生，那支腳本需要金鑰、跑在本機。
 * 但校對是**線上作業**：以前草稿只落在 `.data/drafts/`，線上的校對頁因此
 * 永遠是空的 —— 抽取和校對被實體地切成兩台機器。
 *
 * **語料和草稿存在一起。** 分開存就會出現「草稿在、語料不在」的半套狀態，
 * 而那會讓校對頁顯示一堆對不上原文的引用，看起來像抽取品質很差，
 * 其實只是資料沒到齊。
 */

export type DraftBundle = {
  draft: Record<string, unknown>;
  /** docId → 原文全文。citation.verify 的比對對象，不得經過任何改寫 */
  corpus: Map<string, string>;
};

const ID_RE = /^[a-z0-9-]+$/i;

export interface DraftStore {
  readonly kind: "supabase" | "file";
  list(): Promise<string[]>;
  load(packId: string): Promise<DraftBundle | null>;
  save(packId: string, bundle: DraftBundle): Promise<void>;
}

// ------------------------------------------------------------ 檔案替身

const DRAFT_DIR = dataDir("drafts");
const CORPUS_DIR = join(process.cwd(), "src", "lib", "rules", "corpus");

class FileDraftStore implements DraftStore {
  readonly kind = "file" as const;

  async list(): Promise<string[]> {
    if (!existsSync(DRAFT_DIR)) return [];
    return readdirSync(DRAFT_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }

  async load(packId: string): Promise<DraftBundle | null> {
    if (!ID_RE.test(packId)) return null;
    const p = join(DRAFT_DIR, `${packId}.json`);
    if (!existsSync(p)) return null;

    const draft = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    return { draft, corpus: corpusFromFiles(draft) };
  }

  async save(packId: string, bundle: DraftBundle): Promise<void> {
    if (!ID_RE.test(packId)) throw new Error(`不合法的 packId：${packId}`);
    mkdirSync(DRAFT_DIR, { recursive: true });
    writeFileSync(join(DRAFT_DIR, `${packId}.json`), JSON.stringify(bundle.draft, null, 2), "utf8");
    // 檔案模式下語料本來就寫在 corpus 目錄，這裡不重複寫一份
  }
}

/** 草稿宣告的語料檔在 repo 的 corpus 目錄裡 */
export function corpusFromFiles(draft: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const docs = (draft.documents as { id: string; corpusFile?: string }[] | undefined) ?? [];
  for (const d of docs) {
    if (!d.corpusFile) continue;
    const p = join(CORPUS_DIR, d.corpusFile);
    if (existsSync(p)) map.set(d.id, readFileSync(p, "utf8"));
  }
  return map;
}

// ------------------------------------------------------------ Supabase

class SupabaseDraftStore implements DraftStore {
  readonly kind = "supabase" as const;

  async list(): Promise<string[]> {
    const db = await supabaseClient();
    const { data, error } = await db.from("rulepack_drafts").select("pack_id").order("created_at");
    if (error) throw new Error(`讀取 rulepack_drafts 失敗：${error.message}`);
    return (data ?? []).map((r) => (r as { pack_id: string }).pack_id);
  }

  async load(packId: string): Promise<DraftBundle | null> {
    if (!ID_RE.test(packId)) return null;
    const db = await supabaseClient();
    const { data } = await db
      .from("rulepack_drafts")
      .select("draft, corpus")
      .eq("pack_id", packId)
      .maybeSingle();
    if (!data) return null;

    const row = data as { draft: Record<string, unknown>; corpus: Record<string, string> };
    return { draft: row.draft, corpus: new Map(Object.entries(row.corpus ?? {})) };
  }

  async save(packId: string, bundle: DraftBundle): Promise<void> {
    if (!ID_RE.test(packId)) throw new Error(`不合法的 packId：${packId}`);
    const db = await supabaseClient();
    const { error } = await db.from("rulepack_drafts").upsert({
      pack_id: packId,
      draft: bundle.draft,
      corpus: Object.fromEntries(bundle.corpus),
      created_at: new Date().toISOString(),
    });
    if (error) throw new Error(`寫入 rulepack_drafts 失敗：${error.message}`);
  }
}

let store: DraftStore | null = null;

export function draftStore(): DraftStore {
  if (!store) store = supabaseConfigured() ? new SupabaseDraftStore() : new FileDraftStore();
  return store;
}
