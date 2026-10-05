import { describe, it, expect } from "vitest";
import { isPdf } from "@/lib/util/file-type";

describe("上傳檔案看內容，不只看副檔名（E4）", () => {
  it("真的 PDF", () => expect(isPdf(Buffer.from("%PDF-1.7\n..."))).toBe(true));
  it("改了副檔名的 HTML 擋下", () => expect(isPdf(Buffer.from("<html><script>alert(1)</script>"))).toBe(false));
  it("空檔擋下", () => expect(isPdf(Buffer.alloc(0))).toBe(false));
});
