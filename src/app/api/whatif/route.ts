import { NextResponse } from "next/server";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { resolveRulePack } from "@/lib/rules/loader";
import { parseIntent } from "@/lib/whatif/intent";
import { simulate } from "@/lib/whatif/simulate";
import { LlmBudget, LlmBudgetExceeded } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { fixture?: string; term?: string; scenario?: string };

/**
 * POST /api/whatif —— 情境試算。
 *
 * 與 /api/plan 相同，審查結果由相同輸入重新推導而非伺服器端 session：
 * 修課紀錄不落地是 docs/SPEC.md §9 的硬性要求。
 *
 * LLM 只做意圖解析，之後全部交給確定性推算；
 * 意圖不明回問一個澄清問題，對應不到任何情境就明確說不處理。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.scenario?.trim()) {
    return NextResponse.json({ error: "缺少試算內容。" }, { status: 400 });
  }
  const { fixture, term } = parsePageParams({ fixture: body.fixture, term: body.term });

  const session = await getAuditSession(fixture, term);
  if (!session.outcome.ok) {
    return NextResponse.json({ error: session.outcome.error.reason }, { status: 422 });
  }
  const { audit, state } = session.outcome;
  const record = state.record!;

  const resolved = resolveRulePack(record.student);
  if (!resolved.ok) return NextResponse.json({ error: resolved.detail }, { status: 422 });

  const budget = new LlmBudget();
  let intent;
  try {
    intent = await parseIntent(
      body.scenario,
      {
        nextTerm: audit.nextTerm,
        unmetCourses: state.plans.flatMap((p) => p.courses.map((c) => `${c.name}（${c.code}）`)),
      },
      budget,
    );
  } catch (err) {
    if (err instanceof LlmBudgetExceeded) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    // 意圖解析失敗不猜測，改請使用者換個說法
    return NextResponse.json({
      kind: "clarify",
      question: "無法解析這句話的意圖，請改以更具體的方式描述，例如「我想在 115-1 畢業」。",
      llm: budget.usage,
    });
  }

  if (intent.kind === "clarify") {
    return NextResponse.json({ kind: "clarify", question: intent.question, llm: budget.usage });
  }
  if (intent.kind === "out-of-scope") {
    return NextResponse.json({ kind: "out-of-scope", message: intent.message, llm: budget.usage });
  }

  const result = simulate({
    scenario: intent.scenario,
    audit,
    record,
    pack: (state.pack ?? resolved.pack),
  });

  return NextResponse.json({
    kind: "result",
    traceId: audit.traceId,
    scenario: intent.scenario,
    result,
    llm: budget.usage,
  });
}
