import { NextResponse } from "next/server";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { resolveRulePack } from "@/lib/rules/loader";
import { offeringsFor } from "@/lib/offerings";
import {
  constraintsFrom,
  describeConstraints,
  requirementsFrom,
  reservedFrom,
  solveWithRelaxation,
  PRESET_OF_GOAL,
  type SolveContext,
} from "@/lib/solver/schedule";
import { constraintSetFrom, describeSet, preferencesOf, periodNamesFor } from "@/lib/chat/apply";
import type { CoursePreferences } from "@/lib/types";
import type { OptionalPreferences } from "@/lib/ui/prefs";
import { termLimitsFor } from "@/lib/rules/term-limits";
import { schoolOf } from "@/lib/schools";
import { takenCourseCodes } from "@/lib/solver/taken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  /** 資料來源識別；與頁面網址的查詢參數相同 */
  fixture?: string;
  term?: string;
  /** 使用者在個人資料頁設定的選課傾向；未帶則使用案例預設 */
  preferences?: CoursePreferences;
  /** 選填偏好；只影響排序，不影響可行性與判定 */
  optional?: OptionalPreferences;
};

/**
 * POST /api/plan —— 依選課傾向產生第一版課表。
 *
 * 這條路徑完全不含 LLM：輸入是結構化的選課傾向，輸出是求解器的結果。
 * 對話式的逐輪調整走 /api/chat（docs/CONVERSATION.md A 介面）。
 *
 * 審查結果由相同輸入重新推導（受 docs/BACKEND.md §8 的 10 分鐘快取保護），
 * 而不是從伺服器端的 session 撈回來 ——
 * 修課紀錄僅於單次 request 生命週期處理、不落地（docs/SPEC.md §9）。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const { fixture, term } = parsePageParams({ fixture: body?.fixture, term: body?.term });

  const session = await getAuditSession(fixture, term);
  if (!session.outcome.ok) {
    return NextResponse.json({ error: session.outcome.error.reason }, { status: 422 });
  }
  const { audit, state } = session.outcome;
  const record = state.record!;

  const resolved = resolveRulePack(record.student);
  if (!resolved.ok) return NextResponse.json({ error: resolved.detail }, { status: 422 });
  const pack = resolved.pack;

  const preferences = body?.preferences
    ? preferencesOf(body.preferences)
    : preferencesOf(record.preferences);

  const requirements = requirementsFrom(audit);
  const limits = termLimitsFor(pack, record.student, audit.nextTerm);
  const constraints = constraintsFrom(preferences, limits);
  const constraintSet = constraintSetFrom(preferences);
  const common = {
    traceId: audit.traceId,
    preferences,
    constraints: constraintSet,
    appliedConstraints: describeSet(constraintSet, periodNamesFor(record.student.school)),
  };

  if (requirements.length === 0) {
    return NextResponse.json({
      ...common,
      plans: [],
      excluded: { candidatesBeforeFilter: 0, excludedBy: [] },
      message: "各類別學分均已滿足或修課中，無須推薦下學期課程。",
    });
  }

  const [year, t] = parseTerm(audit.nextTerm);
  const ctx: SolveContext = {
    offerings: offeringsFor(year, t, schoolOf(record.student)),
    requirements,
    passedCodes: new Set(
      record.courses
        .filter((c) => c.status === "passed" || c.status === "waived")
        .map((c) => c.equivalentOf ?? c.code),
    ),
    takenCodes: takenCourseCodes(record.courses, pack),
    reserved: reservedFrom(record.plannedCommitments),
    preferences,
    constraints,
    termLabel: audit.nextTerm,
    termMinCredits: limits.minCredits,
    termMaxCredits: limits.maxCredits,
    optional: body?.optional,
  };

  const result = solveWithRelaxation(ctx, PRESET_OF_GOAL[preferences.goal], []);

  if (!result.ok) {
    // 無解不回空清單 —— 回報是哪些條件在打架，並附上可放寬的方向
    return NextResponse.json({
      ...common,
      plans: [],
      excluded: result.excluded,
      conflicts: result.infeasibilities,
      relaxations: result.relaxations,
    });
  }

  return NextResponse.json({
    ...common,
    plans: result.plans,
    excluded: result.excluded,
    relaxations: result.relaxations,
  });
}

function parseTerm(label: string): [number, 1 | 2] {
  const m = /^(\d+)-([12])$/.exec(label);
  if (!m) throw new Error(`學期代號格式錯誤：${label}`);
  return [Number(m[1]), Number(m[2]) as 1 | 2];
}
