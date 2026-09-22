import { NextResponse } from "next/server";
import { runAudit } from "@/lib/agent/runner";
import { traceStore } from "@/lib/store";
import type { ProviderKind } from "@/lib/types";
import type { FixtureId } from "@/lib/providers/fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  providerKind?: ProviderKind;
  payload?: unknown;
  fixture?: FixtureId;
  currentTerm?: string;
};

/**
 * POST /api/audit —— 執行審查。
 *
 * 中止時回 422 並附中止原因，不回半套結果：
 * 寧可中止並說明，不輸出可能錯誤的結果（BACKEND.md §9）。
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "請求內容不是合法的 JSON。" }, { status: 400 });
  }

  const providerKind = body.providerKind ?? "mock";
  if (providerKind !== "mock" && providerKind !== "upload") {
    return NextResponse.json(
      { error: "providerKind 僅支援 mock 與 upload；本系統不代為登入校務系統。" },
      { status: 400 },
    );
  }

  const result = await runAudit({
    providerKind,
    payload: body.payload,
    fixture: body.fixture,
    currentTerm: body.currentTerm,
  });

  const store = traceStore();
  await store.saveTrace(result.trace).catch(() => undefined);

  if (!result.ok) {
    return NextResponse.json(
      {
        traceId: result.trace.id,
        kind: result.error.kind,
        error: result.error.reason,
        steps: result.trace.steps,
      },
      { status: result.error.kind === "all-hold" ? 200 : 422 },
    );
  }

  return NextResponse.json({ audit: result.audit, plans: result.state.plans, trace: result.trace });
}
