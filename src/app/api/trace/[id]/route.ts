import { NextResponse } from "next/server";
import { traceStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/trace/:id —— 取回完整執行紀錄。
 * 內容為去識別後的資料，可直接匯出作為可查核的 trace（決賽交付項目）。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const trace = await traceStore().loadTrace(id);
  if (!trace) {
    return NextResponse.json({ error: "查無此執行紀錄，或已逾保留期限（90 天）。" }, { status: 404 });
  }
  return NextResponse.json({
    steps: trace.steps,
    toolCalls: trace.steps.flatMap((s) => s.toolCalls.map((c) => ({ stepIdx: s.idx, ...c }))),
    blockedContent: trace.blockedContent,
    meta: {
      id: trace.id,
      createdAt: trace.createdAt,
      studentHash: trace.studentHash,
      rulePackId: trace.rulePackId,
      rulePackVersion: trace.rulePackVersion,
      totalMs: trace.totalMs,
      status: trace.status,
      llm: trace.llm,
      abortReason: trace.abortReason,
    },
  });
}
