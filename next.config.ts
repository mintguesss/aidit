import type { NextConfig } from "next";

/**
 * 安全標頭（TODO E6）。
 *
 * CSP 只在 production 加：開發模式的熱更新需要 eval。Next 的頁面有內嵌 script／style，
 * 所以 script-src、style-src 仍要 'unsafe-inline' —— 擋不了內嵌注入，但擋得住載入外部腳本、
 * 被別的網站用 iframe 嵌入、表單送到別處。字型來自 Google Fonts。
 */
const isProd = process.env.NODE_ENV === "production";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProd
    ? [
        { key: "Content-Security-Policy", value: CSP },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers: async () => [
    { source: "/:path*", headers: SECURITY_HEADERS },
    // 審查結果含個人修課資料，一律不快取於 CDN
    {
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
    },
  ],
};

export default nextConfig;
