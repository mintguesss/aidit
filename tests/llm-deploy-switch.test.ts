import { describe, expect, it } from "vitest";
import { llmAvailable, llmDisabledByDeploy } from "@/lib/llm/client";

/**
 * 正式站預設不接模型：比賽結束後線上 demo 只當展示用，公開網址不能持續花 API 費用。
 */
describe("正式站的模型開關", () => {
  const key = { ANTHROPIC_API_KEY: "test-key" };

  it("Vercel production 即使設了金鑰也不接模型", () => {
    const env = { ...key, VERCEL_ENV: "production" };
    expect(llmDisabledByDeploy(env)).toBe(true);
    expect(llmAvailable(env)).toBe(false);
  });

  it("設 AIDIT_LLM_ENABLED=1 才重新接模型", () => {
    const env = { ...key, VERCEL_ENV: "production", AIDIT_LLM_ENABLED: "1" };
    expect(llmDisabledByDeploy(env)).toBe(false);
    expect(llmAvailable(env)).toBe(true);
  });

  it("本機與 preview 部署照舊看金鑰", () => {
    expect(llmAvailable({ ...key })).toBe(true);
    expect(llmAvailable({ ...key, VERCEL_ENV: "preview" })).toBe(true);
    expect(llmAvailable({})).toBe(false);
  });
});
