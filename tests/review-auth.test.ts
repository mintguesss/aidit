import { describe, it, expect } from "vitest";
import { checkReviewPassword, hashReviewPassword, reviewerFromSession, signReviewSession } from "@/lib/review/auth";

/** 校對登入（E2）。密碼與雜湊不進 repo：環境變數，或資料庫裡加鹽的 scrypt 雜湊 */
describe("校對登入", () => {
  const stored = hashReviewPassword("correct horse battery");

  it("環境變數優先；資料庫雜湊次之；都沒有時正式部署不給登入、本機開發放行", async () => {
    expect((await checkReviewPassword("s3cret-env", { password: "s3cret-env" })).ok).toBe(true);
    expect(await checkReviewPassword("wrong", { password: "s3cret-env" })).toMatchObject({ ok: false, status: 401 });
    expect((await checkReviewPassword("correct horse battery", { stored })).ok).toBe(true);
    expect(await checkReviewPassword("correct horse", { stored })).toMatchObject({ ok: false, status: 401 });
    expect(await checkReviewPassword("anything", { production: true })).toMatchObject({ ok: false, status: 503 });
    expect((await checkReviewPassword("anything", { production: false })).ok).toBe(true);
    expect(await checkReviewPassword(null, { stored })).toMatchObject({ ok: false, status: 401 });
  });

  it("雜湊加鹽：同一個密碼每次存的都不一樣", () => {
    expect(hashReviewPassword("same password").hash).not.toBe(hashReviewPassword("same password").hash);
  });

  it("登入後的 cookie 帶出校對人姓名", async () => {
    const c = { stored, secret: "k" };
    expect(await reviewerFromSession(await signReviewSession("校對人", 0, c), 1000, c)).toBe("校對人");
  });

  it("竄改、過期、密碼換了：一律不認", async () => {
    const c = { stored, secret: "k" };
    const t = await signReviewSession("校對人", 0, c);
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ n: "別人", exp: 9e15 })).toString("base64url");
    expect(await reviewerFromSession(`${forged}.${sig}`, 1000, c)).toBeNull();
    expect(await reviewerFromSession(`${payload}.${sig}`, 13 * 3600_000, c)).toBeNull();
    expect(await reviewerFromSession(t, 1000, { stored: hashReviewPassword("new one"), secret: "k" })).toBeNull();
    expect(await reviewerFromSession(undefined, 0, c)).toBeNull();
  });
});
