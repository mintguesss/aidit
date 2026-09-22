import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths";
import type { Trace } from "@/lib/types";

/**
 * Trace 儲存（BACKEND.md §6）。
 *
 * 正式環境為 Supabase（Postgres），欄位對應 traces / trace_steps / tool_calls /
 * blocked_content 四張表。沒有連線設定時退回本地檔案替身，讓 Demo 與評測
 * 在無憑證的機器上也能完整跑完 —— 兩者走同一個介面。
 *
 * 這裡刻意不存修課紀錄。SPEC.md §9 要求「僅於單次 request 生命週期處理，不落地」，
 * 因此情境試算與選課微調改為以相同輸入重新推導審查結果
 * （見 src/lib/audit/session.ts 的 10 分鐘快取），而不是把學生資料留在伺服器上。
 * 落地的只有去識別後的 trace。
 */

export interface TraceStore {
  readonly kind: "supabase" | "file";
  saveTrace(trace: Trace): Promise<void>;
  loadTrace(id: string): Promise<Trace | null>;
  purgeExpired(): Promise<number>;
  /**
   * 刪除某位學生的全部執行紀錄（以 studentHash 為鍵）。
   *
   * 這是資料主體的刪除權，但它有代價：執行紀錄是系統對自己判定的稽核證據，
   * 刪掉之後「系統當初告訴我什麼、依據是什麼」就再也查不到。
   * 呼叫端必須把這件事講清楚，不能當成一個無害的清理動作。
   */
  purgeByStudent(studentHash: string): Promise<number>;
  /**
   * 連線／可寫檢查，供 /api/health 使用。
   *
   * 「設定了 Supabase」和「Supabase 真的能用」是兩件事：漏跑 migration 時
   * insert 會失敗，而 saveTrace 的失敗是被呼叫端吞掉的（那是刻意的，
   * 儲存失敗不該讓審查中止）。所以要有一條路徑把這個錯誤講出來。
   */
  health(): Promise<{ ok: boolean; detail: string }>;
}

/** trace 保留 90 天後自動刪除 */
export const TRACE_TTL_DAYS = 90;

// ------------------------------------------------------------ 檔案替身

class FileTraceStore implements TraceStore {
  readonly kind = "file" as const;
  private dir = dataDir("traces");

  private ensure(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  async saveTrace(trace: Trace): Promise<void> {
    this.ensure();
    writeFileSync(join(this.dir, `${trace.id}.json`), JSON.stringify(trace, null, 2), "utf8");
  }

  async loadTrace(id: string): Promise<Trace | null> {
    const p = join(this.dir, `${id}.json`);
    if (!/^[0-9a-f-]{8,64}$/i.test(id) || !existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as Trace;
  }

  async purgeByStudent(studentHash: string): Promise<number> {
    if (!existsSync(this.dir) || !/^[0-9a-f]{32}$/.test(studentHash)) return 0;
    let n = 0;
    for (const f of readdirSync(this.dir)) {
      const p = join(this.dir, f);
      try {
        const t = JSON.parse(readFileSync(p, "utf8")) as Trace;
        if (t.studentHash === studentHash) {
          unlinkSync(p);
          n++;
        }
      } catch {
        /* 壞掉的檔案跳過，不影響其他筆 */
      }
    }
    return n;
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      this.ensure();
      const probe = join(this.dir, ".health");
      writeFileSync(probe, "", "utf8");
      unlinkSync(probe);
      return { ok: true, detail: `可寫入 ${this.dir}` };
    } catch (e) {
      return { ok: false, detail: `${this.dir} 無法寫入：${String(e)}` };
    }
  }

  async purgeExpired(): Promise<number> {
    if (!existsSync(this.dir)) return 0;
    const cutoff = Date.now() - TRACE_TTL_DAYS * 24 * 3600 * 1000;
    let n = 0;
    for (const f of readdirSync(this.dir)) {
      const p = join(this.dir, f);
      if (statSync(p).mtimeMs < cutoff) {
        unlinkSync(p);
        n++;
      }
    }
    return n;
  }
}

// ------------------------------------------------------------ Supabase

class SupabaseTraceStore implements TraceStore {
  readonly kind = "supabase" as const;

  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  private async client() {
    // supabase-js 的 Realtime 需要全域 WebSocket，而 Node 22 之前沒有。
    // 本模組只用 PostgREST（from().select/insert/delete），一次 Realtime 都沒有，
    // 但 client 建構時就會檢查，所以在 Node 20 上得先補上。
    if (typeof globalThis.WebSocket === "undefined") {
      const ws = await import("ws");
      (globalThis as { WebSocket?: unknown }).WebSocket = ws.default;
    }
    const { createClient } = await import("@supabase/supabase-js");
    return createClient(this.url, this.key, { auth: { persistSession: false } });
  }

  async saveTrace(trace: Trace): Promise<void> {
    const db = await this.client();
    await db.from("traces").insert({
      id: trace.id,
      created_at: trace.createdAt,
      student_hash: trace.studentHash,
      rule_pack_id: trace.rulePackId,
      rule_pack_version: trace.rulePackVersion,
      total_ms: trace.totalMs,
      status: trace.status,
      llm_calls: trace.llm.calls,
      llm_cost_usd: trace.llm.costUsd,
      abort_reason: trace.abortReason ?? null,
    });
    await db.from("trace_steps").insert(
      trace.steps.map((s) => ({
        trace_id: trace.id,
        idx: s.idx,
        name: s.name,
        status: s.status,
        summary: s.summary,
        ms: s.ms,
        retries: s.retries,
      })),
    );
    await db.from("tool_calls").insert(
      trace.steps.flatMap((s) =>
        s.toolCalls.map((c, seq) => ({
          trace_id: trace.id,
          step_idx: s.idx,
          seq,
          name: c.name,
          input_json: c.input,
          output_json: c.output,
          ms: c.ms,
          status: c.status,
          error: c.error ?? null,
        })),
      ),
    );
    if (trace.blockedContent.length > 0) {
      await db.from("blocked_content").insert(
        trace.blockedContent.map((b) => ({
          trace_id: trace.id,
          source_url: b.sourceUrl,
          excerpt: b.excerpt,
          pattern_matched: b.patternMatched,
          blocked_at: b.blockedAt,
        })),
      );
    }
  }

  async loadTrace(id: string): Promise<Trace | null> {
    const db = await this.client();
    const { data: head } = await db.from("traces").select("*").eq("id", id).maybeSingle();
    if (!head) return null;
    const { data: steps } = await db.from("trace_steps").select("*").eq("trace_id", id).order("idx");
    const { data: calls } = await db.from("tool_calls").select("*").eq("trace_id", id).order("seq");
    const { data: blocked } = await db.from("blocked_content").select("*").eq("trace_id", id);

    return {
      id: head.id,
      createdAt: head.created_at,
      studentHash: head.student_hash,
      rulePackId: head.rule_pack_id,
      rulePackVersion: head.rule_pack_version,
      totalMs: head.total_ms,
      status: head.status,
      abortReason: head.abort_reason ?? undefined,
      llm: { calls: head.llm_calls, inputTokens: 0, outputTokens: 0, costUsd: Number(head.llm_cost_usd) },
      steps: (steps ?? []).map((s) => ({
        idx: s.idx,
        name: s.name,
        label: s.name,
        status: s.status,
        summary: s.summary,
        ms: s.ms,
        retries: s.retries,
        toolCalls: (calls ?? [])
          .filter((c) => c.step_idx === s.idx)
          .map((c) => ({
            name: c.name,
            input: c.input_json,
            output: c.output_json,
            ms: c.ms,
            status: c.status,
            error: c.error ?? undefined,
          })),
      })),
      blockedContent: (blocked ?? []).map((b) => ({
        sourceUrl: b.source_url,
        excerpt: b.excerpt,
        patternMatched: b.pattern_matched,
        blockedAt: b.blocked_at,
      })),
    };
  }

  async purgeByStudent(studentHash: string): Promise<number> {
    if (!/^[0-9a-f]{32}$/.test(studentHash)) return 0;
    const db = await this.client();
    const { count } = await db
      .from("traces")
      .delete({ count: "exact" })
      .eq("student_hash", studentHash);
    return count ?? 0;
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const db = await this.client();
      const { error } = await db.from("traces").select("id").limit(1);
      if (error) {
        // 最常見的是 migration 沒跑：relation "traces" does not exist
        return { ok: false, detail: `查詢 traces 失敗：${error.message}` };
      }
      return { ok: true, detail: "traces 可查詢" };
    } catch (e) {
      return { ok: false, detail: `連線失敗：${String(e)}` };
    }
  }

  async purgeExpired(): Promise<number> {
    const db = await this.client();
    const cutoff = new Date(Date.now() - TRACE_TTL_DAYS * 24 * 3600 * 1000).toISOString();
    const { count } = await db.from("traces").delete({ count: "exact" }).lt("created_at", cutoff);
    return count ?? 0;
  }
}

let store: TraceStore | null = null;

export function traceStore(): TraceStore {
  if (store) return store;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  store = url && key ? new SupabaseTraceStore(url, key) : new FileTraceStore();
  return store;
}
