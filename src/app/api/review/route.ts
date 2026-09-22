import { NextResponse } from "next/server";
import { saveDecision, lockPack, type ReviewDecision } from "@/lib/review/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body =
  | { action: "decide"; packId: string; decision: Omit<ReviewDecision, "decidedAt"> }
  | { action: "lock"; packId: string; reviewer: string };

/**
 * 人工校對的寫入端點。
 *
 * 這是內部作業頁面，不對外開放；正式部署須置於內部網段或加上身分驗證。
 * 校對紀錄（誰、何時、通過或修正）會保留下來作為資料品質的證據。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.packId) return NextResponse.json({ error: "缺少 packId。" }, { status: 400 });

  try {
    if (body.action === "decide") {
      if (!body.decision?.reviewer?.trim()) {
        return NextResponse.json({ error: "請填寫校對人姓名或代號。" }, { status: 400 });
      }
      const record = await saveDecision(body.packId, {
        ...body.decision,
        decidedAt: new Date().toISOString(),
      });
      return NextResponse.json({ record });
    }

    if (body.action === "lock") {
      if (!body.reviewer?.trim()) {
        return NextResponse.json({ error: "鎖版必須記錄校對人。" }, { status: 400 });
      }
      const r = await lockPack(body.packId, body.reviewer);
      return r.ok
        ? NextResponse.json({ ok: true, path: r.path })
        : NextResponse.json({ error: r.reason }, { status: 409 });
    }

    return NextResponse.json({ error: "未知的 action。" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 },
    );
  }
}
