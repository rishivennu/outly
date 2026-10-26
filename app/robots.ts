import type { MetadataRoute } from "next";

const BASE = process.env.APP_URL ?? "http://localhost:3040";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The app itself needs a session; crawling it only produces login redirects.
        disallow: ["/api/", "/admin", "/home", "/create", "/content", "/calendar", "/analytics", "/inbox", "/approvals", "/billing", "/settings", "/support", "/mascot", "/accounts", "/share-target", "/login", "/signup", "/unsubscribe", "/review/", "/team/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
