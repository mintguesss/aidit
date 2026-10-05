import { NextResponse } from "next/server";
import { allOfferings, fetchedAt, rawOfferings } from "@/lib/offerings";
import { preloadOfferings } from "@/lib/offerings/published";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/offering/<code> —— 該門課的原始開課資料。
 *
 * 「課綱」頁上的每個欄位都是從這份原始資料正規化來的。把原始列直接給出去，
 * 承辦人或學生就能自己核對「系統看到的」與「課程查詢系統上的」是不是同一件事 ——
 * 抓取時間、未正規化的時段字串、大綱裡的先修文字都在裡面。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const upper = code.toUpperCase();

  await preloadOfferings();
  // 以前只查合成資料，輔大的課查不到。各校課號格式不重疊，全部一起查不會查錯
  const raw = rawOfferings().filter((o) => o.code.toUpperCase() === upper);
  if (raw.length === 0) {
    return NextResponse.json({ error: `開課資料中查無課號 ${code}` }, { status: 404 });
  }
  const normalized = allOfferings().filter((o) => o.code.toUpperCase() === upper);
  const school = raw[0]!.school ?? "demo";

  const body = JSON.stringify(
    {
      note:
        school === "demo"
          ? "本檔為評測用合成資料，非真實開課資訊。raw 為抓取當下的原始列，normalized 為正規化後供系統使用的形狀。"
          : "raw 為抓取當下的原始列（同一門課每一班一列），normalized 為正規化後供系統使用的形狀。",
      code: upper,
      source: school === "demo" ? "課程查詢系統（合成）" : "輔仁大學學生資訊平台課程查詢、系上課表",
      fetchedAt: fetchedAt(school),
      raw,
      normalized,
    },
    null,
    2,
  );

  return new NextResponse(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="offering-${upper}.json"`,
    },
  });
}
