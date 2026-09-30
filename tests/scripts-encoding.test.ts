import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PowerShell 腳本必須是帶 BOM 的 UTF-8。
 *
 * Windows PowerShell 5.1 讀沒有 BOM 的 .ps1 時用系統碼頁（繁中 Windows 是 Big5），
 * 不是 UTF-8。中文的多位元組會被誤讀、吃掉引號，整支腳本在解析階段就失敗 ——
 * scripts/deploy.ps1 最早的版本就是這樣，從來沒能在家用主機上跑過。
 *
 * 任何編輯器存檔都可能把 BOM 拿掉，所以要有測試守著，而不是靠記得。
 */
const dir = join(process.cwd(), "scripts");
const files = readdirSync(dir).filter((f) => f.endsWith(".ps1"));

describe("PowerShell 腳本編碼", () => {
  it("至少有一支 .ps1（否則下面的檢查形同虛設）", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} 以 UTF-8 BOM 開頭`, () => {
      const b = readFileSync(join(dir, f));
      expect([b[0], b[1], b[2]]).toEqual([0xef, 0xbb, 0xbf]);
    });
  }
});
