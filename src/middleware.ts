import { NextResponse, type NextRequest } from "next/server";

/**
 * API 速率限制（TODO E5）。
 *
 * 會呼叫模型的端點（/api/chat、/api/whatif）沒有限制的話，一個迴圈就能把額度跑完；
 * 單輪的 LLM 呼叫上限只擋單次請求，不擋請求數。
 *
 * 計數放在記憶體：每個執行個體各算各的。在 Vercel 上同一個人打到不同個體會各自計數，
 * 所以實際上限會比這裡寬鬆 —— 這是擋住失控迴圈的第一道，不是精確的配額。
 * 要精確就得把計數放到共用儲存（Supabase、KV），等有真實使用者再做。
 */

const WINDOW_MS = 60_000;
const LIMITS: { prefix: string; max: number }[] = [
  { prefix: "/api/chat", max: 15 },
  { prefix: "/api/whatif", max: 15 },
  { prefix: "/api/plan", max: 30 },
  { prefix: "/api/review", max: 30 },
  { prefix: "/api/declarations", max: 30 },
  { prefix: "/api/preferences", max: 30 },
  { prefix: "/api/rulepack", max: 10 },
];

const hits = new Map<string, number[]>();

export function middleware(req: NextRequest) {
  const rule = LIMITS.find((l) => req.nextUrl.pathname.startsWith(l.prefix));
  if (!rule || req.method === "GET") return NextResponse.next();

  const now = Date.now();
  // 全體合計的上限：自架（next start 直接對外）時 x-forwarded-for 是用戶端自己送的，
  // Next 只在沒有這個標頭時才補上真實位址，每次換一個假 IP 就能繞過單一 IP 的限制。
  // middleware 拿不到連線的真實位址，所以加一道不看 IP 的總量上限（單一 IP 的 4 倍），
  // 偽造標頭最多也只能用到這個量
  const allKey = `${rule.prefix}:*`;
  const all = (hits.get(allKey) ?? []).filter((t) => now - t < WINDOW_MS);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const key = `${rule.prefix}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  const blockedBy = recent.length >= rule.max ? recent : all.length >= rule.max * 4 ? all : null;
  if (blockedBy) {
    const retry = Math.ceil((WINDOW_MS - (now - blockedBy[0]!)) / 1000);
    return NextResponse.json(
      { error: `請求太頻繁，請 ${retry} 秒後再試。` },
      { status: 429, headers: { "Retry-After": String(retry) } },
    );
  }
  recent.push(now);
  hits.set(key, recent);
  all.push(now);
  hits.set(allKey, all);

  // 不讓表無限長大：偶爾清掉一分鐘內沒動靜的
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1]! >= WINDOW_MS) hits.delete(k);
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
