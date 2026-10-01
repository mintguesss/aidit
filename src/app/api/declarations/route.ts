import { NextResponse } from "next/server";
import { getAuditSession, invalidateAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { studentHash } from "@/lib/util/identity";
import { prefsStore, type StoredServerPrefs } from "@/lib/store/prefs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 畢業條件的自行勾選。
 *
 * 只開放學校資料看不出來（待確認）的條件 —— 由審查結果的 declarable 決定，不是前端說了算。
 * 學校紀錄說未通過的，這裡改不動。勾選結果跟偏好存在一起（以 studentHash 為鍵），
 * 在「資料與隱私」刪除偏好時一併刪除。
 */

type Body = { fixture?: string; term?: string; checkId?: string; passed?: boolean };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.checkId || typeof body.passed !== "boolean") {
    return NextResponse.json({ error: "缺少 checkId 或 passed。" }, { status: 400 });
  }
  const { fixture, term } = parsePageParams({ fixture: body.fixture, term: body.term });
  const session = await getAuditSession(fixture, term);
  if (!session.outcome.ok) return NextResponse.json({ error: "審查未完成，無法勾選。" }, { status: 409 });

  const check = session.outcome.audit.graduationChecks.find((g) => g.id === body.checkId);
  if (!check?.declarable) {
    return NextResponse.json({ error: "這一項以學校紀錄為準，不能自行勾選。" }, { status: 422 });
  }

  const student = session.outcome.audit.student;
  const hash = studentHash(student.id);
  const store = prefsStore();
  const current = await store.load(hash);
  const declarations = { ...(current?.declarations ?? {}) };
  if (body.passed) declarations[check.id] = { passed: true, at: new Date().toISOString() };
  else delete declarations[check.id];

  const next: StoredServerPrefs = {
    required: current?.required ?? session.preferences,
    optional: current?.optional ?? { interestAreas: [], avoidCourseTypes: [] },
    lastUsedAt: new Date().toISOString(),
    status: student.status,
    declarations,
  };
  const ok = await store.save(hash, next);
  if (!ok) return NextResponse.json({ error: "儲存失敗。" }, { status: 500 });

  invalidateAuditSession(fixture);
  return NextResponse.json({ ok: true, declarations });
}
