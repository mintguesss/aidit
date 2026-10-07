import { NextResponse } from "next/server";
import { allOfferings } from "@/lib/offerings";
import { preloadOfferings } from "@/lib/offerings/published";

export const runtime = "nodejs";

/**
 * 匿名展示模式要遮的教師姓名（lib/anon.ts）。開課資料本來就是公開的，這裡只是把名單集中給顯示層。
 */
export async function GET() {
  await preloadOfferings().catch(() => undefined);
  const teachers = new Set<string>();
  for (const o of allOfferings()) {
    for (const t of (o.teacher ?? "").split(/[、,，/／\s]+/)) if (t.trim().length >= 2) teachers.add(t.trim());
  }
  return NextResponse.json({ teachers: [...teachers] }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
