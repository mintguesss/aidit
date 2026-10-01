import { NextResponse } from "next/server";
import { getAuditSession, invalidateAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { studentHash } from "@/lib/util/identity";
import { prefsStore, PREF_TTL_MONTHS, type StoredServerPrefs } from "@/lib/store/prefs-store";
import { traceStore } from "@/lib/store";
import type { CoursePreferences } from "@/lib/types";
import type { OptionalPreferences } from "@/lib/ui/prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 偏好的讀寫與刪除。
 *
 * 以 `studentHash`（HMAC，不可逆）為鍵 —— 伺服器上不存任何可識別欄位。
 * 刪除是真的刪：檔案移除，不是標記為已刪除。
 *
 * 管轄範圍只有偏好與執行紀錄兩項。
 */

type Body = {
  fixture?: string;
  term?: string;
  required?: CoursePreferences;
  optional?: OptionalPreferences;
  /** DELETE 用：只刪選填 / 全部偏好 / 連同執行紀錄 */
  scope?: "optional" | "preferences" | "all";
};

async function identify(body: Body | null) {
  const { fixture, term } = parsePageParams({ fixture: body?.fixture, term: body?.term });
  const session = await getAuditSession(fixture, term);
  const student = session.outcome.ok
    ? session.outcome.audit.student
    : session.outcome.state.record?.student;
  if (!student) return null;
  return { hash: studentHash(student.id), status: student.status, session };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const who = await identify(body);
  if (!who) return NextResponse.json({ error: "無法識別學籍。" }, { status: 422 });

  // 讀取
  if (!body?.required) {
    const v = await prefsStore().load(who.hash);
    return NextResponse.json({ stored: v, ttlMonths: PREF_TTL_MONTHS });
  }

  // 寫入。畢業條件的自行勾選不在瀏覽器那一份裡，沿用伺服器上的，不能被偏好的同步蓋掉
  const current = await prefsStore().load(who.hash);
  const next: StoredServerPrefs = {
    required: body.required,
    optional: body.optional ?? { interestAreas: [], avoidCourseTypes: [] },
    lastUsedAt: new Date().toISOString(),
    status: who.status,
    ...(current?.declarations ? { declarations: current.declarations } : {}),
  };
  const ok = await prefsStore().save(who.hash, next);
  return NextResponse.json({ ok, stored: ok ? next : null });
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const who = await identify(body);
  if (!who) return NextResponse.json({ error: "無法識別學籍。" }, { status: 422 });

  const scope = body?.scope ?? "preferences";
  if (scope === "optional") {
    return NextResponse.json({ ok: await prefsStore().deleteOptional(who.hash), scope });
  }

  const ok = await prefsStore().delete(who.hash);
  // 畢業條件的自行勾選跟著偏好一起刪了，審查結果要重算
  invalidateAuditSession(parsePageParams({ fixture: body?.fixture, term: body?.term }).fixture);
  let traces = 0;
  if (scope === "all") {
    traces = await traceStore()
      .purgeByStudent(who.hash)
      .catch(() => 0);
  }
  // 日誌只記筆數，不含任何個人識別資訊
  console.info(
    `[aidit][erasure] ${new Date().toISOString()} scope=${scope} prefs=${ok ? 1 : 0} traces=${traces}`,
  );
  return NextResponse.json({ ok, scope, traces });
}
