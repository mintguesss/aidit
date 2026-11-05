import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { REVIEW_COOKIE, reviewerFromSession } from "@/lib/review/auth";
import { actionSchema, applyAction, publicView } from "@/lib/trial/session";
import { deleteSession, loadSession, saveSession } from "@/lib/trial/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 受試者頁面：憑連結裡的隨機 id 存取，回傳內容不含標準答案與批改結果 */
export async function GET(_req: Request, { params }: Ctx) {
  const session = await loadSession((await params).id);
  if (!session) return NextResponse.json({ error: "找不到這筆試用。" }, { status: 404 });
  return NextResponse.json(publicView(session, Date.now()));
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await loadSession((await params).id);
  if (!session) return NextResponse.json({ error: "找不到這筆試用。" }, { status: 404 });
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "資料格式不對。" }, { status: 400 });
  const now = Date.now();
  const result = applyAction(session, parsed.data, now);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  await saveSession(session);
  return NextResponse.json(publicView(session, now));
}

/** 刪除一筆紀錄：只有登入的主持人可以，畫面上要先確認 */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await reviewerFromSession((await cookies()).get(REVIEW_COOKIE)?.value))) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await loadSession(id))) return NextResponse.json({ error: "找不到這筆試用。" }, { status: 404 });
  await deleteSession(id);
  return NextResponse.json({ ok: true });
}
