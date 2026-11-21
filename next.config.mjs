// Content Security Policy: enforced since 1033, per request with a nonce, in middleware.ts (lib/csp.ts).
// Pages the middleware doesn't see (the offline page the service worker keeps) get this script-free one.
const staticCsp = "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

// 1149: PostHog through a same-origin proxy (/ingest), so the CSP needs nothing new and blockers see a first-party call.
// Mirrors lib/analytics/config.ts (this file can't import TypeScript).
const posthogHost = (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com").trim().replace(/\/+$/, "");
const posthogAssets = posthogHost.replace(/^https:\/\/(us|eu)\.i\./, "https://$1-assets.i.");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // R1283: the build a page was served with, inlined into server and client code. components/pwa/FreshOnResume.tsx
  // compares it with /api/build when an installed app comes back, so a page kept alive for days learns it is old.
  env: { NEXT_PUBLIC_BUILD: process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD || "dev" },
  // Production only: in dev, gzipping ~10 MB of unminified JS per page load on one thread made localhost take 10 s+.
  compress: process.env.NODE_ENV === "production",
  // Lets parallel dev servers run from one checkout without clobbering each other's build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Next 15: stable top-level key (was experimental.serverComponentsExternalPackages); instrumentation is on by default.
  serverExternalPackages: ["@prisma/client", "bcryptjs", "bullmq", "ioredis"],
  // 1113: keep every server function small (Vercel stores a copy per function per kept deployment, and a
  // smaller function starts faster). The file tracer sees `resolve(process.cwd(), "storage")` and
  // `join(process.cwd(), "public", ...)` and copies those folders (plus test, doc and CLI files) into functions.
  // None are read at runtime: public files are served by the CDN, media lives in the bucket.
  // public/brand/app stays (lib/brand/icon-url.ts hashes it). Note: Next applies these globs on Linux (Vercel);
  // on Windows the backslash paths don't match, so a local build still lists them.
  outputFileTracingExcludes: {
    "*": [
      "./storage/**",
      "./tests/**",
      "./docs/**",
      "./scripts/**",
      "./prisma/*.db",
      "./prisma/*.db-journal",
      "./outly-*/**",
      "./node_modules/@electric-sql/**",
      "./node_modules/@prisma/engines/**",
      "./node_modules/prisma/**",
      "./node_modules/typescript/**",
      "./node_modules/@swc/core*/**",
      "./node_modules/esbuild*/**",
      "./node_modules/@esbuild/**",
      "./public/audio/**",
      "./public/samples/**",
      "./public/brands/**",
      "./public/brand/avatar-*.png",
      "./public/brand/bimi.svg",
      "./public/brand/email/**",
      "./public/brand/founding/**",
      "./public/brand/pay/**",
      "./public/brand/rocket/**",
    ],
  },
  experimental: {
    // tree-shake the big icon/animation/chart libraries so pages only ship what they import
    optimizePackageImports: ["lucide-react", "framer-motion", "recharts", "date-fns"],
    // 1116: keep a visited dynamic page in the browser's router cache for 30 s. Without it Next drops the page you
    // landed on (usually Home) at once, so going back to it refetched (0.65 s) while every preloaded tab opened instantly.
    // Changes still show at once: they call router.refresh(), which empties this cache, and PageFresh tops a page up
    // in the background once it is older than its maxAge.
    staleTimes: { dynamic: 30 },
  },
  images: { formats: ["image/avif", "image/webp"] },
  // R1294: the bare domain answers /.well-known/* itself (Android App Links verification never follows a redirect)
  // and sends every other path to www, as the Vercel domain redirect does today. This only takes effect once the
  // outlly.com domain in Vercel is connected to Production instead of "Redirect to www.outlly.com" (until then the
  // request never reaches the deployment). Steps: outlly-compose/docs/release.md.
  redirects: async () => [
    { source: "/:path((?!\\.well-known(?:/|$)).*)", has: [{ type: "host", value: "outlly\\.com" }], destination: "https://www.outlly.com/:path", permanent: true },
  ],
  rewrites: async () => [
    { source: "/ingest/static/:path*", destination: `${posthogAssets}/static/:path*` },
    { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
  ],
  headers: async () => [
    // Brand art and sample posters: cached by browsers for a day and by a CDN for a week,
    // so repeat visits and many users at once don't touch the app server for images.
    {
      source: "/(brand|samples)/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" }],
    },
    // Home-screen icons (1106): always checked with the server (a cheap 304 when unchanged), so an installed app's
    // update check never gets a stale copy. Listed after the rule above, so this header wins for these files.
    { source: "/brand/app/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }] },
    // Email fonts (1058): mail apps load @font-face cross-origin, which needs CORS. Google Fonts sent this header for us before.
    { source: "/brand/email/fonts/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
    { source: "/offline.html", headers: [{ key: "Content-Security-Policy", value: staticCsp }] },
    // Phone check page (1042): its own script file only, same-origin requests only.
    { source: "/check.html", headers: [{ key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }, { key: "Cache-Control", value: "no-store" }] },
    { source: "/check.js", headers: [{ key: "Cache-Control", value: "no-store" }] },
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        // HTTPS only for two years, subdomains too. Production only so http://localhost keeps working.
        // Add "; preload" and submit at hstspreload.org only once every subdomain of the custom domain serves https.
        ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
      ],
    },
  ],
};
export default nextConfig;
