import { describe, it, expect } from "vitest";
import { checkReviewPassword } from "@/lib/review/auth";

describe("校對端點的密碼（E2）", () => {
  it("有設環境變數：以它為準，對的放行、錯的或沒給的 401", () => {
    const env = { password: "s3cret" };
    expect(checkReviewPassword("s3cret", env).ok).toBe(true);
    expect(checkReviewPassword("0311", env)).toMatchObject({ ok: false, status: 401 });
    expect(checkReviewPassword(null, env)).toMatchObject({ ok: false, status: 401 });
  });

  it("沒設環境變數：用預設密碼，仍然要密碼", () => {
    expect(checkReviewPassword("0311", {}).ok).toBe(true);
    expect(checkReviewPassword("wrong", {})).toMatchObject({ ok: false, status: 401 });
    expect(checkReviewPassword(null, { password: "" })).toMatchObject({ ok: false, status: 401 });
  });
});
