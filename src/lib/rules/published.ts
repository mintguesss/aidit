import { zRulePack, type RulePack } from "./schema";
import { supabaseClient, supabaseConfigured } from "@/lib/store/supabase";
import { contentHash } from "@/lib/util/identity";

/**
 * 執行期發布的規則包與語料（docs/BACKEND.md §2）。
 *
 * repo 裡的檔案仍然是基準：golden set 與 CI 靠它在無憑證的機器上離線跑完，
 * 那是「正確率不得下降」這道門檻能成立的前提。這裡放的是**人工校對鎖版後**
 * 產生的版本 —— 那些本來被寫進 `src/lib/rules/packs/`，也就是原始碼目錄，
 * 在 serverless 上唯讀，必然失敗。
 *
 * 讀取時與 repo 版本合併，同 id 以資料庫版本為準（它比較新，而且經過校對）。
 */

export type PublishedRules = { packs: RulePack[]; corpus: Map<string, string> };

export async function fetchPublishedRules(): Promise<PublishedRules> {
  const empty: PublishedRules = { packs: [], corpus: new Map() };
  if (!supabaseConfigured()) return empty;

  const db = await supabaseClient();

  const { data: packRows, error: packErr } = await db.from("rule_packs").select("id, pack");
  if (packErr) throw new Error(`讀取 rule_packs 失敗：${packErr.message}`);

  const packs: RulePack[] = [];
  for (const row of packRows ?? []) {
    const parsed = zRulePack.safeParse((row as { pack: unknown }).pack);
    if (!parsed.success) {
      // 資料庫裡的規則包沒通過 schema 就整包不用，不做部分採用 ——
      // 半套的規則包會算出看起來合理但錯的結果，那比沒有規則包更危險。
      throw new Error(`資料庫規則包 ${(row as { id: string }).id} 未通過 schema 驗證`);
    }
    packs.push({
      ...parsed.data,
      contentHash: parsed.data.contentHash ?? contentHash((row as { pack: unknown }).pack),
    });
  }

  const { data: docRows, error: docErr } = await db.from("corpus_docs").select("doc_id, body");
  if (docErr) throw new Error(`讀取 corpus_docs 失敗：${docErr.message}`);

  const corpus = new Map<string, string>();
  for (const r of docRows ?? []) {
    const row = r as { doc_id: string; body: string };
    corpus.set(row.doc_id, row.body);
  }

  return { packs, corpus };
}

/** 鎖版：把校對完成的規則包與其語料寫進資料庫 */
export async function publishRulePack(
  pack: RulePack,
  corpus: Map<string, string>,
  lockedBy: string,
): Promise<void> {
  const db = await supabaseClient();
  const now = new Date().toISOString();

  const { error } = await db.from("rule_packs").upsert({
    id: pack.id,
    version: pack.version,
    pack,
    locked_by: lockedBy,
    locked_at: now,
  });
  if (error) throw new Error(`寫入 rule_packs 失敗：${error.message}`);

  if (corpus.size > 0) {
    const rows = [...corpus].map(([doc_id, body]) => {
      const doc = pack.documents.find((d) => d.id === doc_id);
      return {
        doc_id,
        title: doc?.title ?? doc_id,
        published_at: doc?.publishedAt ?? null,
        body,
        updated_at: now,
      };
    });
    const { error: e2 } = await db.from("corpus_docs").upsert(rows);
    if (e2) throw new Error(`寫入 corpus_docs 失敗：${e2.message}`);
  }
}
