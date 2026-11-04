import { describe, expect, it } from "vitest";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { z } from "zod/v4";
import { modelSchema } from "@/lib/llm/client";

/**
 * zod 4.6 把可為 null 的欄位寫成 type: ["x", "null"]，SDK 的 transformJSONSchema 認不得，
 * 巢狀物件會少掉 additionalProperties: false，模型服務可能以 400 退回。
 */
describe("送給模型的 JSON Schema", () => {
  const schema = z.object({
    flag: z.boolean().nullable(),
    count: z.number().int().min(1).max(7).nullable().describe("幾門"),
    delta: z.object({ a: z.string() }).nullable(),
  });
  const hasTypeArray = (n: unknown): boolean =>
    Array.isArray(n)
      ? n.some(hasTypeArray)
      : Boolean(n) && typeof n === "object" && Object.entries(n as object).some(([k, v]) => (k === "type" && Array.isArray(v)) || hasTypeArray(v));

  it("可為 null 一律寫成 anyOf，不留 type 陣列", () => {
    const out = modelSchema(schema) as { properties: Record<string, { anyOf?: unknown[]; description?: string }> };
    expect(hasTypeArray(out)).toBe(false);
    expect(out.properties.flag!.anyOf).toEqual([{ type: "boolean" }, { type: "null" }]);
    expect(out.properties.count!.description).toBe("幾門");
  });

  it("經過 SDK 轉換後，巢狀物件仍有 additionalProperties: false", () => {
    const out = transformJSONSchema(modelSchema(schema));
    expect(JSON.stringify(out)).toContain('"additionalProperties":false');
    const delta = (out as { properties: { delta: { anyOf: { type: string; additionalProperties?: boolean }[] } } }).properties.delta;
    expect(delta.anyOf.find((v) => v.type === "object")!.additionalProperties).toBe(false);
  });
});
