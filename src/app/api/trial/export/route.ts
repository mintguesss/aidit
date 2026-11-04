import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { REVIEW_COOKIE, reviewerFromSession } from "@/lib/review/auth";
import { toCsv } from "@/lib/trial/session";
import { listSessions } from "@/lib/trial/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 匯出全部紀錄。排除的和放棄的也都在裡面，由「是否排除」欄標記，不在這裡過濾 */
export async function GET() {
  if (!(await reviewerFromSession((await cookies()).get(REVIEW_COOKIE)?.value))) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }
  return new NextResponse(toCsv(await listSessions()), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="trial-records.csv"',
      "cache-control": "no-store",
    },
  });
}
