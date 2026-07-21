import type { NextConfig } from "next";

// CSP connect-src には本番の Supabase ワイルドカード（https://*.supabase.co）に加え、
// ビルド時に設定された Supabase エンドポイント（NEXT_PUBLIC_SUPABASE_URL）の origin を
// http/ws 両方で動的に許可する。これによりローカル（http://127.0.0.1:54321）への
// browser-side supabase 接続・Realtime も通る。本番では https://<project>.supabase.co が
// 既存ワイルドカードと重複するだけで無影響。
function supabaseConnectSources(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "";
  try {
    const origin = new URL(url).origin;
    const wsOrigin = origin.replace(/^http/, "ws");
    return `${origin} ${wsOrigin}`;
  } catch {
    return "";
  }
}

const connectSrc = [
  "connect-src 'self'",
  "https://*.supabase.co wss://*.supabase.co",
  supabaseConnectSources(),
  "https://maps.googleapis.com https://maps.gstatic.com",
]
  .filter(Boolean)
  .join(" ");

const securityHeaders = [
  {
    // preload は付けない。付けると全サブドメインの恒久 HTTPS 化にコミットすることになり、
    // 解除に数ヶ月かかる実質不可逆な操作になるため（2026-07-21 判断）。
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      connectSrc,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // localhost 以外（127.0.0.1 等）から dev サーバーへのアクセスを許可する（dev専用・本番無影響）。
  // E2E をローカル dev に向けて 127.0.0.1 で実行しても cross-origin block でハイドレーションが
  // 止まらないようにするための保険。本番ビルドには影響しない。
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
