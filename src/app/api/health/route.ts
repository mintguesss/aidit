import { NextResponse } from "next/server";
import { traceStore } from "@/lib/store";
import { prefsStore } from "@/lib/store/prefs-store";
import { dataDir } from "@/lib/store/paths";
import { LLM, MODEL_LABEL, LLM_REASONING_EFFORT, LLM_TIMEOUT_MS, llmAvailable } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health —— 這個部署實際上接到了什麼。
 *
 * 存在的理由：三種部署（Vercel、家用主機、本機）的差別全在環境變數，
 * 而錯誤設定多半是**靜默**的 —— trace 存不進去會被 catch 掉、
 * 模型沒接上會退回離線替身，兩者都不會讓頁面壞掉。從外面看一切正常，
 * 其實根本沒在用你以為的那套。這條路徑把實際狀態講出來。
 *
 * 只回報「種類」與「通不通」，不回報任何 URL、金鑰或其內容。
 */
export async function GET() {
  const store = traceStore();
  const storeHealth = await store.health();
  const prefs = prefsStore();
  const prefsHealth = await prefs.health();

  // 開發預設值等於全世界都能重算你的雜湊，正式部署必須改掉
  const traceSecretSet = Boolean(process.env.AIDIT_TRACE_SECRET);

  const body = {
    ok: storeHealth.ok && prefsHealth.ok && traceSecretSet,
    // Node 22 之前沒有原生 WebSocket，supabase-js 的 client 建構會因此失敗
    node: process.version,
    store: {
      kind: store.kind,
      ok: storeHealth.ok,
      detail: storeHealth.detail,
      dataDir: store.kind === "file" ? dataDir() : null,
      // 兩個都設定才會啟用 Supabase。只回報「有沒有設」，不回報值 ——
      // 少一個就退回檔案替身，而那是靜默的，從頁面上看不出來。
      configured: {
        SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
    },
    prefs: {
      kind: prefs.kind,
      ok: prefsHealth.ok,
      detail: prefsHealth.detail,
    },
    llm: {
      provider: LLM.provider,
      model: MODEL_LABEL,
      // false = 走確定性替身。Vercel 公開 demo 刻意維持 false
      available: llmAvailable(),
      timeoutMs: LLM_TIMEOUT_MS,
      // 思考型模型沒設 none 時一次解析要十幾秒，常逾時
      reasoningEffort: LLM_REASONING_EFFORT ?? null,
    },
    traceSecret: traceSecretSet ? "set" : "dev-default（正式部署必須改掉）",
  };

  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
