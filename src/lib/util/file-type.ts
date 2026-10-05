/**
 * 檔案內容的型別檢查。只看副檔名的話，改個副檔名就能把別種檔案送進來（TODO E4）。
 */

/** PDF 檔頭：%PDF-（規格允許前面有少量雜訊，在前 1024 位元組內找） */
export function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 1024).includes(Buffer.from("%PDF-"));
}
