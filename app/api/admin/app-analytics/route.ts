import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { readPaging } from "@/components/admin/page-window";
import { parseRange } from "@/lib/analytics/activity-core";
import { activeSeries, engagement, exportCsv, isExportKind, overview, parseQuery, parseUserFilters, platforms, retention, usersCsv, usersPage } from "@/lib/admin/app-analytics";

export const dynamic = "force-dynamic";

const csv = (body: string, name: string) =>
  new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="outlly-app-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
    },
  });

/**
 * R1308 App Analytics as JSON (?part=overview|series|engagement|retention|platforms|users, default everything but users)
 * or as CSV (?export=users|daily|buckets|retention|cohorts|platforms|events|features). The same filters as the page:
 * r / from / to for the range, g for the bucket, platform, and for users q / status / joined / platform / sort / page.
 */
export const GET = adminRoute("appAnalytics", async (req, { admin }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const range = parseRange({ r: sp.r, from: sp.from, to: sp.to });
  const q = parseQuery(sp, range);
  const exp = sp.export;
  if (exp === "users") return csv(await usersCsv(parseUserFilters(sp, { page: 1, limit: 5000 }), admin.role), "users");
  if (isExportKind(exp)) return csv(await exportCsv(exp, q), exp);
  const part = sp.part ?? "all";
  if (part === "users") return json({ range, users: await usersPage(parseUserFilters(sp, readPaging(req.nextUrl.searchParams)), admin.role) }, { headers: { "cache-control": "no-store" } });
  const want = (k: string) => part === "all" || part === k;
  const [ov, series, eng, ret, plat] = await Promise.all([
    want("overview") ? overview(q) : null,
    want("series") ? activeSeries(q) : null,
    want("engagement") ? engagement(q) : null,
    want("retention") ? retention(q) : null,
    want("platforms") ? platforms(q) : null,
  ]);
  return json({ range, g: q.g, platform: q.platform, overview: ov, series, engagement: eng, retention: ret, platforms: plat }, { headers: { "cache-control": "no-store" } });
}, [60, 60_000]);
