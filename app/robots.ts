import type { MetadataRoute } from "next";

const BASE = process.env.APP_URL ?? "http://localhost:3040";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // 1143: only the API is blocked. The app pages used to be listed here too, but a blocked page can still be
        // indexed from a link, and Google can't read a noindex it may not fetch. Those pages now answer with
        // X-Robots-Tag: noindex (middleware.ts, NOINDEX), which removes them from the index for good.
        disallow: ["/api/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
