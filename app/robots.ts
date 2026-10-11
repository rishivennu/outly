import type { MetadataRoute } from "next";

const BASE = process.env.APP_URL ?? "http://localhost:3040";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The app itself needs a session; crawling it only produces login redirects.
        disallow: ["/api/", "/home", "/create", "/content", "/calendar", "/analytics", "/settings", "/accounts", "/login", "/signup"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
