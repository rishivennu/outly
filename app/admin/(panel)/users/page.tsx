import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { formatMoney } from "@/lib/billing/money";
import { SAMPLE_DOMAIN } from "@/lib/admin/sample";
import { PLATFORMS, PLATFORM_META } from "@/lib/domain";
import { Card, Empty, PageHead, Pill, Table, ago, fmtDate } from "@/components/admin/ui";
import { FilterChips, FilterSelect, SearchBox } from "@/components/admin/SearchBox";
import { RefreshButton } from "@/components/admin/RefreshButton";
import { looksRelayed, placeLabel } from "@/lib/geo";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic"; // Refresh must always read fresh rows
const PER = 50;

type Params = { q?: string; f?: string; plan?: string; joined?: string; platform?: string; tag?: string; sort?: string; page?: string };

const JOINED = [
  { value: "", label: "Any time" },
  { value: "1", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];
const TAGS = [
  { value: "", label: "Anyone" },
  { value: "founding", label: "Founding members" },
  { value: "2fa", label: "Two-step sign-in on" },
  { value: "no2fa", label: "Two-step sign-in off" },
  { value: "verified", label: "Email proven" },
  { value: "unverified", label: "Email not proven" },
  { value: "noposts", label: "Never posted" },
  { value: "noaccounts", label: "Nothing connected" },
  { value: "referred", label: "Came from a referral" },
  { value: "real", label: "Real people only" },
  { value: "sample", label: "Sample users only" },
];
const SORTS = [
  { value: "", label: "Newest first" },
  { value: "old", label: "Oldest first" },
  { value: "active", label: "Last active" },
  { value: "name", label: "Name, A to Z" },
  { value: "posts", label: "Most posts" },
];

// Postgres matches text case-sensitively unless asked; SQLite (dev) already ignores case and has no `mode`.
const ci = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? { mode: "insensitive" as const } : {};

/** Only values from the lists above get through: anything else reads as "no filter". */
const pick = (v: string | undefined, list: { value: string }[]) => (v && list.some((o) => o.value === v) ? v : "");

export default async function Users({ searchParams }: { searchParams: Params }) {
  await requireAdmin("users");
  const q = searchParams.q?.trim().slice(0, 120);
  const f = ["paying", "active", "dormant"].includes(searchParams.f ?? "") ? searchParams.f! : "";
  const plans = await db.plan.findMany({ orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } });
  const PLANS = [{ value: "", label: "Any plan" }, { value: "free", label: "Free" }, ...plans.filter((p) => p.slug !== "free" && p.name.toLowerCase() !== "free").map((p) => ({ value: p.slug, label: p.name }))];
  const PLATS = [{ value: "", label: "Any platform" }, ...PLATFORMS.map((p) => ({ value: p, label: PLATFORM_META[p].name }))];
  const plan = pick(searchParams.plan, PLANS);
  const joined = pick(searchParams.joined, JOINED);
  const platform = pick(searchParams.platform, PLATS);
  const tag = pick(searchParams.tag, TAGS);
  const sort = pick(searchParams.sort, SORTS);
  const page = Math.min(10000, Math.max(1, Math.floor(Number(searchParams.page)) || 1));
  const since7 = new Date(Date.now() - 7 * 864e5);

  // Every filter is its own AND clause, so two that both need an OR (search + dormant) never overwrite each other.
  const and: object[] = [];
  if (q) and.push({ OR: [{ name: { contains: q, ...ci } }, { email: { contains: q, ...ci } }] });
  if (f === "paying") and.push({ subscriptions: { some: { status: "active" } } });
  if (f === "active") and.push({ lastActiveAt: { gte: since7 } });
  if (f === "dormant") and.push({ OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: since7 } }] });
  if (plan === "free") and.push({ subscriptions: { none: { status: "active" } } });
  else if (plan) and.push({ subscriptions: { some: { status: "active", plan: { slug: plan } } } });
  if (joined) and.push({ createdAt: { gte: new Date(Date.now() - Number(joined) * 864e5) } });
  if (platform) and.push({ socialAccounts: { some: { platform, status: "connected" } } });
  if (tag === "founding") and.push({ foundingNo: { not: null } });
  if (tag === "2fa") and.push({ totpEnabledAt: { not: null } });
  if (tag === "no2fa") and.push({ totpEnabledAt: null });
  if (tag === "verified") and.push({ emailVerifiedAt: { not: null } });
  if (tag === "unverified") and.push({ emailVerifiedAt: null });
  if (tag === "noposts") and.push({ posts: { none: {} } });
  if (tag === "noaccounts") and.push({ socialAccounts: { none: { status: "connected" } } });
  if (tag === "referred") and.push({ referredById: { not: null } });
  if (tag === "real") and.push({ NOT: { email: { endsWith: SAMPLE_DOMAIN } } });
  if (tag === "sample") and.push({ email: { endsWith: SAMPLE_DOMAIN } });
  const where = and.length ? { AND: and } : {};
  const orderBy =
    sort === "old" ? [{ createdAt: "asc" as const }]
    : sort === "active" ? [{ lastActiveAt: { sort: "desc" as const, nulls: "last" as const } }, { createdAt: "desc" as const }]
    : sort === "name" ? [{ name: "asc" as const }]
    : sort === "posts" ? [{ posts: { _count: "desc" as const } }, { createdAt: "desc" as const }]
    : [{ createdAt: "desc" as const }];

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy,
      take: PER,
      skip: (page - 1) * PER,
      select: {
        id: true, name: true, email: true, createdAt: true, lastActiveAt: true, lastSeenAt: true, foundingNo: true, totpEnabledAt: true, timezone: true,
        locCountry: true, locRegion: true, locCity: true, locVia: true, locAt: true,
        subscriptions: { where: { status: "active" }, take: 1, select: { priceMinor: true, currency: true, cancelAtPeriodEnd: true, plan: { select: { name: true } } } },
        _count: { select: { tickets: true, posts: true } },
      },
    }),
    db.user.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER));
  const kept = { ...(q ? { q } : {}), ...(f ? { f } : {}), ...(plan ? { plan } : {}), ...(joined ? { joined } : {}), ...(platform ? { platform } : {}), ...(tag ? { tag } : {}), ...(sort ? { sort } : {}) };
  const link = (p: number) => `?${new URLSearchParams({ ...kept, page: String(p) })}`;
  // How many filters are narrowing the list (sort only orders it).
  const narrowing = [q, f, plan, joined, platform, tag].filter(Boolean).length;
  return (
    <>
      <PageHead
        eyebrow="Run"
        title="Users"
        body={`${total.toLocaleString("en-IN")} ${narrowing ? "matching" : "creator accounts"}. Last seen updates every minute while someone is in the app; locations are approximate, estimated from the network address.`}
        actions={<RefreshButton total={total} loadedAt={new Date().toISOString()} />}
      />
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <FilterChips param="f" current={f} options={[{ value: "", label: "All" }, { value: "paying", label: "Paying" }, { value: "active", label: "Active 7d" }, { value: "dormant", label: "Dormant" }]} />
          <SearchBox placeholder="Search name or email" />
        </div>
        <div role="group" aria-label="More filters" className="mb-4 flex flex-wrap items-end gap-2.5 border-t border-border/60 pt-3">
          <FilterSelect param="plan" label="Plan" current={plan} options={PLANS} />
          <FilterSelect param="joined" label="Joined" current={joined} options={JOINED} />
          <FilterSelect param="platform" label="Connected" current={platform} options={PLATS} />
          <FilterSelect param="tag" label="Who" current={tag} options={TAGS} />
          <FilterSelect param="sort" label="Sort" current={sort} options={SORTS} />
          {narrowing + (sort ? 1 : 0) > 0 && (
            <Link href="/admin/users" scroll={false} className="inline-flex h-11 items-center rounded-full px-4 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
              Clear filters
            </Link>
          )}
        </div>
        {rows.length === 0 ? (
          <Empty title={q ? `No one matches "${q}"` : narrowing ? "No one matches these filters" : "No users yet"} body={q || narrowing ? "Loosen a filter or try part of an email or a first name." : "Sign-ups appear here as soon as someone creates an account."} />
        ) : (
          <Table head={["User", "Plan", "Last seen", "Location", "Joined", "Posts", "Tickets"]}>
            {rows.map((u) => {
              const s = u.subscriptions[0];
              return (
                <tr key={u.id}>
                  <td>
                    <span className="block font-medium">
                      {u.name}
                      {u.email.endsWith(SAMPLE_DOMAIN) && <Pill className="ml-2" tone="info">sample</Pill>}
                      {u.foundingNo && <Pill className="ml-2" tone="lime">founding #{u.foundingNo}</Pill>}
                      {u.totpEnabledAt && <Pill className="ml-2">2-step</Pill>}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">{u.email}</span>
                  </td>
                  <td>{s ? <span className="flex flex-wrap items-center gap-1.5"><Pill tone="lime">{s.plan.name}</Pill><span className="text-[12px] text-muted-foreground">{formatMoney(s.priceMinor, s.currency)}</span>{s.cancelAtPeriodEnd && <Pill tone="warn">cancelling</Pill>}</span> : <span className="text-muted-foreground">Free</span>}</td>
                  <td className="whitespace-nowrap">
                    {ago(u.lastSeenAt ?? u.lastActiveAt)}
                    {(u.lastSeenAt ?? u.lastActiveAt) && <span className="block text-[11.5px] text-muted-foreground">{fmtStamp(u.lastSeenAt ?? u.lastActiveAt)}</span>}
                  </td>
                  <td className="min-w-[12rem]"><Place u={u} /></td>
                  <td className="whitespace-nowrap text-muted-foreground">{fmtDate(u.createdAt)}</td>
                  <td className="tabular">{u._count.posts}</td>
                  <td className="tabular">{u._count.tickets}</td>
                </tr>
              );
            })}
          </Table>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-[13px]">
            {page > 1 ? <a className="rounded-full px-3 py-1.5 hairline hover:bg-secondary" href={link(page - 1)}>Previous</a> : <span />}
            <span className="text-muted-foreground">Page {page} of {pages}</span>
            {page < pages ? <a className="rounded-full px-3 py-1.5 hairline hover:bg-secondary" href={link(page + 1)}>Next</a> : <span />}
          </nav>
        )}
      </Card>
    </>
  );
}

const fmtStamp = (d: Date | null) => (d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST" : "");

type Loc = { timezone: string; locCountry: string | null; locRegion: string | null; locCity: string | null; locVia: string | null; locAt: Date | null };

/** Where the network says they are (1053): approximate, from the IP only, so it can be a VPN or a carrier hub. */
function Place({ u }: { u: Loc }) {
  const net = placeLabel({ country: u.locCountry, region: u.locRegion, city: u.locCity, via: u.locVia });
  const relayed = u.locVia === "tor" || looksRelayed(u.locCountry, u.timezone);
  if (!net) return <span className="text-[12.5px] text-muted-foreground">Unknown</span>;
  return (
    <div className="text-[12.5px] leading-snug">
      <span className="block" title="Estimated from the network address. Not an exact address.">
        <span aria-hidden>≈ </span>
        {net}
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
        Approximate (network){u.locAt ? ` · ${ago(u.locAt)}` : ""}
        {relayed && <Pill tone="warn">{u.locVia === "tor" ? "Tor" : "possible VPN"}</Pill>}
      </span>
    </div>
  );
}
