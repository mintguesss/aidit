import { NextResponse } from "next/server";
import { loadCorpus, loadRulePacks, preloadPublishedRules } from "@/lib/rules/loader";
import { extraCorpus, loadExtraPacks } from "@/lib/rules/extra-packs";
import { ANNOUNCEMENTS } from "@/lib/rules/announcements";
import { ANON_COOKIE, makeAnonymizer } from "@/lib/anon";
import { allOfferings } from "@/lib/offerings";
import { preloadOfferings } from "@/lib/offerings/published";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/corpus/<docId> —— 被引用文件的原文全文。
 *
 * 畫面上只放得下一段 quote，但「這段引文是不是斷章取義」要看得到上下文才能判斷。
 * `citation.verify` 就是拿這份全文去回查的，所以把同一份檔案直接給出去，
 * 承辦人看到的與系統查核的是同一份東西。
 */
export async function GET(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params;
  // 輔大的規章原文跟規則包一起存在資料庫，沒先載入的話伺服器剛啟動時點引文會 404
  await preloadPublishedRules();
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

  // 合成的示範學校才是「評測用合成原文」；輔大的是真實規章抽出的文字，不能這樣標
  const school =
    loadRulePacks().find((p) => p.documents.some((d) => d.id === docId))?.school ??
    ANNOUNCEMENTS.find((a) => a.contentDocId === docId)?.school;
  const synthetic = !school || school === "demo";
  const header = [
    `# ${doc?.title ?? docId}`,
    doc?.publishedAt ? `發布日期：${doc.publishedAt}` : "",
    `文件代號：${docId}`,
    synthetic
      ? "本檔為評測用合成原文，非真實規章。citation.verify 即以本檔逐條回查引用。"
      : "本檔為原始文件抽出的文字（排版空白可能與原檔不同）。citation.verify 即以本檔逐條回查引用。",
    "",
    "----",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  // 匿名展示模式（預設開啟，cookie 設 0 才關）：下載的檔案一樣要遮校名、系名與教師姓名，
  // 檔名裡的學校代號也換掉。以前是在畫面上把下載連結整個拿掉，結果「下載原文」按了沒反應
  const anon = !new RegExp(`(?:^|;\\s*)${ANON_COOKIE}=0(?:;|$)`).test(req.headers.get("cookie") ?? "");
  let body = `${header}\n${text}`;
  let name = docId;
  if (anon) {
    await preloadOfferings().catch(() => undefined);
    const teachers = allOfferings().flatMap((o) => (o.teacher ?? "").split(/[、,，/／\s]+/));
    body = makeAnonymizer(teachers)(body);
    name = docId.replace(/^fju-/, "school-a-");
  }
  return new NextResponse(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.txt"`,
    },
  });
}
