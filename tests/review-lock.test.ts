import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 鎖版的守門條件。
 *
 * 「需要修正」只記下修正的文字，不會改到草稿 —— 鎖版發布的是原始草稿。
 * 以前它被當成通過：校對者寫了「應該是 9 學分」，發布出去的仍是錯的值，
 * 還被標成「已人工校對」。
 *
 * 只測擋下的情況。鎖版成功會把規則包寫進 src/lib/rules/packs/，那是 repo 本身。
 */

let tmp: string;
let store: typeof import("@/lib/review/store");

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "aidit-review-"));
  mkdirSync(join(tmp, "drafts"), { recursive: true });
  copyFileSync("tests/fixtures/rulepacks/fju-im-111.draft.json", join(tmp, "drafts", "fju-im-111.json"));
  // 草稿與校對紀錄的目錄在模組載入時決定，所以先設環境變數再載入
  vi.stubEnv("AIDIT_DATA_DIR", tmp);
  vi.resetModules();
  store = await import("@/lib/review/store");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

async function decideAll(status: (i: number) => "approved" | "corrected" | "rejected") {
  const view = (await store.loadDraft("fju-im-111"))!;
  for (const [i, item] of view.items.entries()) {
    await store.saveDecision("fju-im-111", {
      itemId: item.id,
      status: status(i),
      note: status(i) === "approved" ? undefined : "測試",
      reviewer: "測試者",
      decidedAt: new Date().toISOString(),
    });
  }
  return view.items.length;
}

describe("鎖版", () => {
  it("有一項「需要修正」就不能鎖版 —— 修正內容不會自動寫進規則包", async () => {
    await decideAll((i) => (i === 3 ? "corrected" : "approved"));
    const r = await store.lockPack("fju-im-111", "測試者");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("需要修正");
  });

  it("有一項退回也不能鎖版", async () => {
    await decideAll((i) => (i === 0 ? "rejected" : "approved"));
    const r = await store.lockPack("fju-im-111", "測試者");
    expect(r.ok).toBe(false);
  });
});
