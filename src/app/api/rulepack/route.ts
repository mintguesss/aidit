import { NextResponse } from "next/server";
import { inspectUploadedPack } from "@/lib/rules/inspect";
import { supabaseClient, supabaseConfigured } from "@/lib/store/supabase";
import { putUpload } from "@/lib/review/uploads";
import { contentHash } from "@/lib/util/identity";
import { isPdf } from "@/lib/util/file-type";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/rulepack —— 上傳自己的課程規劃表。
 *
 * 兩種輸入：
 *   .json　已經是規則包格式 → 結構檢查後可送人工校對
 *   .pdf 　原始規劃表　　　 → 收件並排入抽取，抽取需要 LLM 且結果一律要人工校對
 *
 * **上傳的規則包不會直接生效**。docs/SPEC.md §2 要求規則包經人工校對才鎖版；
 * 這裡如果讓使用者上傳完就拿去判定，等於把整套「可回查、可稽核」的保證讓掉。
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "請選擇一個檔案。" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `檔案大小上限 ${MAX_BYTES / 1024 / 1024} MB。` }, { status: 413 });
  }

  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".json")) {
    let raw: unknown;
    try {
      raw = JSON.parse(buf.toString("utf8"));
    } catch (e) {
      return NextResponse.json({
        kind: "json",
        ok: false,
        issues: [{ level: "error", message: `JSON 解析失敗：${String(e)}` }],
      });
    }
    const r = inspectUploadedPack(raw);
    return NextResponse.json({ kind: "json", ...r });
  }

  if (name.endsWith(".pdf")) {
    // 只看副檔名不夠（TODO E4）：PDF 檔頭一定是「%PDF-」。改了副檔名的別種檔案在這裡擋下，
    // 不會被存起來、也不會送去抽取
    if (!isPdf(buf)) {
      return NextResponse.json({ error: "這個檔案不是 PDF（檔案內容與副檔名不符）。" }, { status: 415 });
    }
    // 收件即留存檔案指紋，之後校對頁才對得上是哪一份
    const hash = contentHash(buf.toString("base64")).slice(0, 12);
    const safe = file.name.replace(/[^\w.\-]/g, "_").slice(0, 60);
    // 中繼資料進資料庫（留得住），檔案本身仍落在暫存區。
    // 暫存區在 serverless 上是 /tmp，換實例就沒了 —— PDF 原檔要真的留存
    // 需要 Supabase Storage，見 docs/TODO.md B5。
    if (supabaseConfigured()) {
      try {
        const db = await supabaseClient();
        await db.from("rulepack_uploads").upsert({
          receipt: hash,
          filename: safe,
          bytes: buf.length,
          uploaded_at: new Date().toISOString(),
        });
      } catch {
        // 中繼資料寫不進去不該擋住上傳，但要留下痕跡
        console.warn(`[aidit][rulepack] 上傳紀錄寫入失敗 receipt=${hash}`);
      }
    }

    try {
      await putUpload(hash, safe, buf);
    } catch (e) {
      return NextResponse.json({ error: `原始檔案無法留存：${String(e)}` }, { status: 500 });
    }
    return NextResponse.json({
      kind: "pdf",
      ok: true,
      receipt: hash,
      filename: safe,
      bytes: buf.length,
      steps: [
        "PDF → 分段文字（保留頁碼與版面）：scripts/pdf-to-segments.py",
        "分段文字 → 規則包草稿（每個欄位都必須帶 quote）：scripts/extract-rulepack.ts",
        "自動驗證（類別學分加總、課號格式、逐條引用回查）：npm run validate:rulepack",
        "人工校對並鎖版：/review",
      ],
    });
  }

  return NextResponse.json({ error: "只接受 .pdf（原始規劃表）或 .json（規則包格式）。" }, { status: 415 });
}
