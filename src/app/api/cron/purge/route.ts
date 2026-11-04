import { NextResponse } from "next/server";
import { traceStore } from "@/lib/store";
import { prefsStore } from "@/lib/store/prefs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 保留政策的排程入口（Vercel Cron，每日一次，見 vercel.json）。
 *
 * scripts/purge.ts 要靠家用主機的工作排程器觸發，正式站在 Vercel 上就沒有人跑它，
 * 「保留 90 天」等於只寫在文件裡（2026-11-04 發現）。
 *
 * Vercel 會自動帶 CRON_SECRET。沒設就一律拒絕，不開放給任何人觸發刪除。
 * 回應只有筆數，不含任何個人識別資訊。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const traces = await traceStore().purgeExpired();
  const preferences = await prefsStore().purgeExpired();
  return NextResponse.json({ traces, preferences });
}
