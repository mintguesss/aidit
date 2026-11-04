import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { REVIEW_COOKIE, reviewerFromSession } from "@/lib/review/auth";
import { moderatorView, newSession } from "@/lib/trial/session";
import { listSessions, saveSession } from "@/lib/trial/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moderator = async () => reviewerFromSession((await cookies()).get(REVIEW_COOKIE)?.value);

/** 主持人後台：列出全部受試者 */
export async function GET() {
  if (!(await moderator())) return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  const rows = await listSessions();
  return NextResponse.json({ rows: rows.map((r) => moderatorView(r.session, r.mod)) });
}

/** 新增一位受試者：依報到順序給代號與組別。練習用的另外編號，匯出時標記排除 */
export async function POST(req: Request) {
  const who = await moderator();
  if (!who) return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { practice?: unknown } | null;
  const practice = body?.practice === true;
  const rows = await listSessions();
  const number = rows.filter((r) => r.session.practice === practice).length + 1;
  const session = newSession({ id: randomBytes(16).toString("hex"), number, practice, createdBy: who, now: Date.now() });
  await saveSession(session);
  return NextResponse.json({ id: session.id, code: session.code, group: session.group });
}
