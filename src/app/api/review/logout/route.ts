import { NextResponse } from "next/server";
import { REVIEW_COOKIE } from "@/lib/review/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/review/login", req.url), 303);
  res.cookies.set(REVIEW_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
