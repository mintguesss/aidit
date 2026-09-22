import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectUploadedPack } from "@/lib/rules/inspect";
import { dataDir } from "@/lib/store/paths";
import { contentHash } from "@/lib/util/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = dataDir("rulepack-uploads");
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/rulepack —— 上傳自己的課程規劃表。
 *
 * 兩種輸入：
 *   .json　已經是規則包格式 → 結構檢查後可送人工校對
 *   .pdf 　原始規劃表　　　 → 收件並排入抽取，抽取需要 LLM 且結果一律要人工校對
 *
 * **上傳的規則包不會直接生效**。SPEC.md §2 要求規則包經人工校對才鎖版；
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
    // 收件即留存檔案指紋，之後校對頁才對得上是哪一份
    const hash = contentHash(buf.toString("base64")).slice(0, 12);
    const safe = file.name.replace(/[^\w.\-]/g, "_").slice(0, 60);
    try {
      mkdirSync(UPLOAD_DIR, { recursive: true });
      writeFileSync(join(UPLOAD_DIR, `${hash}-${safe}`), buf);
    } catch {
      return NextResponse.json({ error: "檔案無法寫入伺服器暫存區。" }, { status: 500 });
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
