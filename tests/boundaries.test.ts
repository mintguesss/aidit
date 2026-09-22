import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkBoundaries, GUARDED, scanSecrets } from "../scripts/lib/checks";

/**
 * 模組邊界（docs/BACKEND.md §10 第 4 條）。
 *
 * 「這是整個專案最重要的一條，因為它用機械方式保證了『算數的那層沒有模型』
 *   這個技術主張。」答詢時可以直接把這個測試調出來給評審看。
 */

describe("模組邊界：確定性運算層不得接觸 LLM", () => {
  it(`${GUARDED.join("、")} 及其相依模組不得 import LLM client`, () => {
    const violations = checkBoundaries();
    expect(violations).toEqual([]);
  });
});

describe("原始碼不得含金鑰或真實學號", () => {
  it("掃描 src、scripts、tests 與設定檔", () => {
    expect(scanSecrets()).toEqual([]);
  });
});

describe("Provider 介面", () => {
  it("沒有任何 api provider 的實作（系統架構上不得代為登入）", () => {
    const dir = join(process.cwd(), "src", "lib", "providers");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    const impl = files.filter((f) => {
      const src = readFileSync(join(dir, f), "utf8");
      return /kind\s*=\s*"api"/.test(src);
    });
    expect(impl).toEqual([]);
  });

  it("沒有任何寫入校務系統的 endpoint", () => {
    const apiDir = join(process.cwd(), "src", "app", "api");
    const routes = walk(apiDir).filter((f) => f.endsWith("route.ts"));
    for (const r of routes) {
      const src = readFileSync(r, "utf8");
      // 任何 route 都不得對校務系統送出寫入請求
      expect(/fetch\(\s*["'`]https?:\/\/(?!example\.invalid)/.test(src)).toBe(false);
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
