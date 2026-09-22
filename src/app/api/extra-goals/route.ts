import { NextResponse } from "next/server";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { registeredGoals, summariseExtraGoals } from "@/lib/extra/goals";
import type { ExtraGoal } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["minor", "double-major", "cert-program", "transfer"];

/**
 * POST /api/extra-goals —— 額外修業目標的相關修課現況。
 *
 * 額外目標存在使用者的瀏覽器（localStorage），所以由前端帶上來；
 * 修課紀錄則與其他頁面一樣，由相同輸入重新推導，不經伺服器 session（docs/SPEC.md §9）。
 * 這條路徑完全不含 LLM。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { fixture?: string; term?: string; goals?: unknown }
    | null;
  const { fixture, term } = parsePageParams({ fixture: body?.fixture, term: body?.term });

  const goals: ExtraGoal[] = Array.isArray(body?.goals)
    ? body.goals
        .filter(
          (g): g is ExtraGoal =>
            Boolean(g) &&
            typeof g === "object" &&
            KINDS.includes((g as ExtraGoal).kind) &&
            typeof (g as ExtraGoal).target === "string",
        )
        .map((g) => ({ kind: g.kind, target: g.target.trim().slice(0, 20) }))
        .slice(0, 4)
    : [];

  const session = await getAuditSession(fixture, term);
  if (!session.outcome.ok) return NextResponse.json({ rows: [] });

  const { audit, state } = session.outcome;
  // 已註冊的目標由學籍資料決定，不需要前端帶上來 ——
  // 一般生沒有這些欄位，自然什麼都不顯示
  const registered = registeredGoals(state.record?.student);
  if (goals.length === 0 && registered.length === 0) return NextResponse.json({ rows: [] });

  const rows = summariseExtraGoals(goals, state.record?.courses ?? [], audit, registered);
  return NextResponse.json({ rows });
}
