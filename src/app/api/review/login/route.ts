import { NextResponse } from "next/server";
import { checkReviewPassword, REVIEW_COOKIE, REVIEW_SESSION_HOURS, signReviewSession } from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 校對登入：姓名＋校對密碼 → 簽章 cookie（lib/review/auth.ts）。速率限制同 /api/review */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: string; password?: string } | null;
  const name = body?.name?.trim().slice(0, 40) ?? "";
  if (!name) return NextResponse.json({ error: "請填寫姓名或代號 —— 每一筆校對都要記下是誰做的。" }, { status: 400 });
  const auth = await checkReviewPassword(body?.password ?? null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const res = NextResponse.json({ ok: true, name });
  res.cookies.set(REVIEW_COOKIE, await signReviewSession(name), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REVIEW_SESSION_HOURS * 3600,
  });
  return res;
}
