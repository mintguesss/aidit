/**
 * 引用錨點與短名。
 *
 * 這兩個函式前端也要用（依據連結），所以獨立成一個不碰 node:fs / node:crypto 的模組 ——
 * 從 sources.ts 匯入會把規則包載入器整包拖進瀏覽器 bundle。
 */

/**
 * 同一份文件的同一個位置只會有一個錨點。
 * 文件代號的校名縮寫換成別名：點「依據」時錨點會出現在網址列，錄影會照到（匿名模式只換畫面文字，換不到網址）。
 * 連結與原文出處頁都由這裡產生錨點，兩邊一致。
 */
export function anchorOf(docId: string, locator: string): string {
  return `c-${docId.replace(/^fju-/, "school-a-")}-${locator.replace(/[^\w\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** 畫面上用的短名，例如「111 學年度資訊管理學系課程規劃表」→「課程規劃表」 */
export function shortTitleOf(title: string): string {
  return title
    .replace(/^\d+\s*學年度\s*/, "")
    .replace(/資訊管理學系|財務金融學系/, "")
    .replace(/\s+/g, "")
    .slice(0, 14);
}
