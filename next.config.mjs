// Content Security Policy: enforced since 1033, per request with a nonce, in middleware.ts (lib/csp.ts).
// Pages the middleware doesn't see (the offline page the service worker keeps) get this script-free one.
const staticCsp = "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Production only: in dev, gzipping ~10 MB of unminified JS per page load on one thread made localhost take 10 s+.
  compress: process.env.NODE_ENV === "production",
  // Lets parallel dev servers run from one checkout without clobbering each other's build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "bullmq", "ioredis"],
    instrumentationHook: true,
    // tree-shake the big icon/animation/chart libraries so pages only ship what they import
    optimizePackageImports: ["lucide-react", "framer-motion", "recharts", "date-fns"],
  },
  images: { formats: ["image/avif", "image/webp"] },
  headers: async () => [
    // Brand art and sample posters: cached by browsers for a day and by a CDN for a week,
    // so repeat visits and many users at once don't touch the app server for images.
    {
      source: "/(brand|samples)/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" }],
    },
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
