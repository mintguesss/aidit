import { describe, it, expect } from "vitest";
import { checkReviewPassword, reviewerFromSession, signReviewSession } from "@/lib/review/auth";

describe("校對登入（E2）", () => {
  it("有設環境變數：以它為準；沒設：用預設密碼，仍然要密碼", () => {
    expect(checkReviewPassword("s3cret", { password: "s3cret" }).ok).toBe(true);
    expect(checkReviewPassword("0311", { password: "s3cret" })).toMatchObject({ ok: false, status: 401 });
    expect(checkReviewPassword("0311", {}).ok).toBe(true);
    expect(checkReviewPassword(null, {})).toMatchObject({ ok: false, status: 401 });
  });

  it("登入後的 cookie 帶出校對人姓名", () => {
    const env = { password: "s3cret", secret: "k" };
    expect(reviewerFromSession(signReviewSession("校對人", 0, env), 1000, env)).toBe("校對人");
  });

  it("竄改、過期、密碼換了：一律不認", () => {
    const env = { password: "s3cret", secret: "k" };
    const t = signReviewSession("校對人", 0, env);
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ n: "別人", exp: 9e15 })).toString("base64url");
    expect(reviewerFromSession(`${forged}.${sig}`, 1000, env)).toBeNull();
    expect(reviewerFromSession(`${payload}.${sig}`, 13 * 3600_000, env)).toBeNull();
    expect(reviewerFromSession(t, 1000, { password: "new", secret: "k" })).toBeNull();
    expect(reviewerFromSession(undefined)).toBeNull();
  });
});
