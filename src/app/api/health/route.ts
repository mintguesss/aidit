import { NextResponse } from "next/server";
import { traceStore } from "@/lib/store";
import { dataDir } from "@/lib/store/paths";
import { LLM, MODEL_LABEL, LLM_TIMEOUT_MS, llmAvailable } from "@/lib/llm/client";

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

  // 開發預設值等於全世界都能重算你的雜湊，正式部署必須改掉
  const traceSecretSet = Boolean(process.env.AIDIT_TRACE_SECRET);

  const body = {
    ok: storeHealth.ok && traceSecretSet,
    // Node 22 之前沒有原生 WebSocket，supabase-js 的 client 建構會因此失敗
    node: process.version,
    store: {
      kind: store.kind,
      ok: storeHealth.ok,
      detail: storeHealth.detail,
      dataDir: store.kind === "file" ? dataDir() : null,
    },
    llm: {
      provider: LLM.provider,
      model: MODEL_LABEL,
      // false = 走確定性替身。Vercel 公開 demo 刻意維持 false
      available: llmAvailable(),
      timeoutMs: LLM_TIMEOUT_MS,
    },
    traceSecret: traceSecretSet ? "set" : "dev-default（正式部署必須改掉）",
  };

  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
