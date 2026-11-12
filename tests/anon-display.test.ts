import { afterEach, describe, expect, it } from "vitest";
import { anonDisplay } from "../src/components/shell/AnonMode";

// 詢問信的內文是程式直接填進 textarea 的 value，顯示層的 MutationObserver 換不到，要先換好再填
const letter = "本人為資管二（日間部）學生\n依據：輔仁大學資訊管理學系修業規則（適用 111 學年入學新生）";

const g = globalThis as { document?: unknown };
const setAnon = (on: boolean) => {
  g.document = { documentElement: { hasAttribute: (a: string) => on && a === "data-anon" } };
};

afterEach(() => {
  delete g.document;
});

describe("anonDisplay", () => {
  it("匿名模式下把校名、系名換掉", () => {
    setAnon(true);
    const out = anonDisplay(letter);
    expect(out).not.toMatch(/輔仁|輔大|資訊管理|資管/);
    expect(out).toContain("A 大學B 學系修業規則");
  });

  it("沒開匿名模式就原樣回傳", () => {
    setAnon(false);
    expect(anonDisplay(letter)).toBe(letter);
  });

  it("伺服器端（沒有 document）原樣回傳", () => {
    expect(anonDisplay(letter)).toBe(letter);
  });
});
