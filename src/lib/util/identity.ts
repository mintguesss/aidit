import { createHmac, randomUUID } from "node:crypto";

/**
 * 去識別工具（docs/BACKEND.md §6）。
 * trace 一律只存 HMAC 後的學生代號，原始識別資訊不得落地。
 */

const SECRET = process.env.AIDIT_TRACE_SECRET ?? "aidit-dev-secret-not-for-production";

export function studentHash(rawId: string): string {
  return createHmac("sha256", SECRET).update(rawId).digest("hex").slice(0, 32);
}

export function newTraceId(): string {
  return randomUUID();
}

/** 內容雜湊，用於審查結果快取 key 與規則包鎖版 */
export function contentHash(value: unknown): string {
  return createHmac("sha256", "aidit-content").update(stableStringify(value)).digest("hex").slice(0, 32);
}

/** 鍵排序後序列化，確保同一份資料永遠得到同一個 hash */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
