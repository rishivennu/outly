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
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ],
};
export default nextConfig;
