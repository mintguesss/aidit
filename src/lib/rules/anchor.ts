/**
 * 引用錨點與短名。
 *
 * 這兩個函式前端也要用（依據連結），所以獨立成一個不碰 node:fs / node:crypto 的模組 ——
 * 從 sources.ts 匯入會把規則包載入器整包拖進瀏覽器 bundle。
 */

/** 同一份文件的同一個位置只會有一個錨點 */
export function anchorOf(docId: string, locator: string): string {
  return `c-${docId}-${locator.replace(/[^\w\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** 畫面上用的短名，例如「111 學年度資訊管理學系課程規劃表」→「課程規劃表」 */
export function shortTitleOf(title: string): string {
  return title
    .replace(/^\d+\s*學年度\s*/, "")
    .replace(/資訊管理學系|財務金融學系/, "")
    .replace(/\s+/g, "")
    .slice(0, 14);
}
