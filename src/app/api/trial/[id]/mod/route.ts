import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { REVIEW_COOKIE, reviewerFromSession } from "@/lib/review/auth";
import { modSchema } from "@/lib/trial/session";
import { loadSession, saveMod } from "@/lib/trial/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 主持人的判定：T2、T3 是否正確、是否協助、備註、排除 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await reviewerFromSession((await cookies()).get(REVIEW_COOKIE)?.value))) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await loadSession(id))) return NextResponse.json({ error: "找不到這筆試用。" }, { status: 404 });
  const parsed = modSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "資料格式不對。" }, { status: 400 });
  if (parsed.data.excluded && !parsed.data.excludeReason) {
    return NextResponse.json({ error: "排除任何一筆都要寫明理由。" }, { status: 400 });
  }
  await saveMod(id, parsed.data);
  return NextResponse.json({ ok: true });
}
