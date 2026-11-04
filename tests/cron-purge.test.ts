import { afterEach, describe, expect, it, vi } from "vitest";

const purgeTraces = vi.fn(async () => 3);
const purgePrefs = vi.fn(async () => 1);
vi.mock("@/lib/store", () => ({ traceStore: () => ({ purgeExpired: purgeTraces }) }));
vi.mock("@/lib/store/prefs-store", () => ({ prefsStore: () => ({ purgeExpired: purgePrefs }) }));

import { GET } from "@/app/api/cron/purge/route";

const call = (auth?: string) =>
  GET(new Request("http://x/api/cron/purge", auth ? { headers: { authorization: auth } } : undefined));

describe("保留政策排程", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.clearAllMocks();
  });

  it("沒設 CRON_SECRET 時一律拒絕，不刪資料", async () => {
    const res = await call("Bearer undefined");
    expect(res.status).toBe(401);
    expect(purgeTraces).not.toHaveBeenCalled();
  });

  it("密鑰不對或沒帶都拒絕", async () => {
    process.env.CRON_SECRET = "right";
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call()).status).toBe(401);
    expect(purgeTraces).not.toHaveBeenCalled();
  });

  it("密鑰正確才清除，回應只有筆數", async () => {
    process.env.CRON_SECRET = "right";
    const res = await call("Bearer right");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ traces: 3, preferences: 1 });
  });
});
