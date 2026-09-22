import { NextResponse } from "next/server";
import { loadCorpus, loadRulePacks } from "@/lib/rules/loader";
import { extraCorpus, loadExtraPacks } from "@/lib/rules/extra-packs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/corpus/<docId> —— 被引用文件的原文全文。
 *
 * 畫面上只放得下一段 quote，但「這段引文是不是斷章取義」要看得到上下文才能判斷。
 * `citation.verify` 就是拿這份全文去回查的，所以把同一份檔案直接給出去，
 * 承辦人看到的與系統查核的是同一份東西。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params;
  const text = loadCorpus().get(docId) ?? extraCorpus().get(docId);

  const doc =
    loadRulePacks()
      .flatMap((p) => p.documents)
      .find((d) => d.id === docId) ??
    loadExtraPacks()
      .map((p) => p.document)
      .find((d) => d.id === docId);

  if (!text) {
    return NextResponse.json(
      {
        error: doc
          ? `文件「${doc.title}」未提供原文語料檔，因此其引用無法在本系統回查。`
          : `查無文件 ${docId}。`,
      },
      { status: 404 },
    );
  }

  const header = [
    `# ${doc?.title ?? docId}`,
    doc?.publishedAt ? `發布日期：${doc.publishedAt}` : "",
    `文件代號：${docId}`,
    "本檔為評測用合成原文，非真實規章。citation.verify 即以本檔逐條回查引用。",
    "",
    "----",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return new NextResponse(header + text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${docId}.txt"`,
    },
  });
}
