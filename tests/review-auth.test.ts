import { describe, it, expect } from "vitest";
import { checkReviewPassword } from "@/lib/review/auth";

describe("校對端點的密碼（E2）", () => {
  it("有設密碼：對的放行、錯的或沒給的 401", () => {
    const env = { password: "s3cret", production: true };
    expect(checkReviewPassword("s3cret", env).ok).toBe(true);
    expect(checkReviewPassword("wrong", env)).toMatchObject({ ok: false, status: 401 });
    expect(checkReviewPassword(null, env)).toMatchObject({ ok: false, status: 401 });
  });

  it("正式部署沒設密碼：一律拒絕，不是誰都能鎖版", () => {
    expect(checkReviewPassword("anything", { password: "", production: true })).toMatchObject({ ok: false, status: 503 });
  });

  it("本機開發沒設密碼：不檢查", () => {
    expect(checkReviewPassword(null, { production: false }).ok).toBe(true);
  });
});
