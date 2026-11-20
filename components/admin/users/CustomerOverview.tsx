import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity, ArrowUpRight, Award, BarChart3, Clock, CreditCard, Flag, Layers, Link2, Mail, MailCheck, MapPin,
  MoonStar, PenLine, Search, ShieldCheck, User, UserPlus, Users,
} from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { placeLabel } from "@/lib/geo";
import { ago, fmtDate } from "@/components/admin/ui";
import { cn } from "@/lib/utils";
import { StoragePanel } from "./StoragePanel";

/**
 * R1180: the Users page in the warm "customer information" style. Server-safe and presentational: the page
 * reads every number from the database and passes it in, so nothing here is estimated or invented.
 */

export type Recent = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  seenAt: Date | null;
  plan: string | null;
  platforms: string[];
  loc: { country: string | null; region: string | null; city: string | null; via: string | null };
};

export type Summary = {
  total: number;
  paying: number;
  active7: number;
  new7: number;
  prev7: number;
  founding: number;
  verified: number;
  connected: number;
  posted: number;
  twoStep: number;
  setUp: number;
  plans: { name: string; count: number }[];
};

const TONES = ["tan", "blue", "lilac", "salmon", "pink", "rose"] as const;
type TileTone = (typeof TONES)[number];

const nf = (n: number) => n.toLocaleString("en-IN");
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
const initials = (name: string, email: string) => {
  const words = (name.trim() || email).split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
};
/** The same person always gets the same avatar colour. */
const toneFor = (id: string): TileTone => TONES[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];
const firstName = (name: string, email: string) => name.trim().split(/\s+/)[0] || email.split("@")[0];

/** Week-on-week change in sign-ups, as a signed percent, or null when last week had none to compare with. */
export function weekDelta(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

function Badge({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span aria-hidden className="cx-badge grid size-10 shrink-0 place-items-center rounded-full">
      <Icon className="size-[18px]" strokeWidth={1.8} />
    </span>
  );
}

/** Round outline action, the reference's edit / add / expand buttons. Always a real link with a name. */
function RoundLink({ href, label, icon: Icon, external }: { href: string; label: string; icon: LucideIcon; external?: boolean }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      scroll={!href.startsWith("?") && !href.startsWith("/admin/users")}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="cx-round grid size-11 shrink-0 place-items-center rounded-full"
    >
      <Icon aria-hidden className="size-[17px]" strokeWidth={1.8} />
    </Link>
  );
}

export function PanelHead({ icon, title, hint, actions, as: H = "h2", id }: { icon: LucideIcon; title: string; hint?: string; actions?: React.ReactNode; as?: "h2" | "h3"; id?: string }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Badge icon={icon} />
        <div className="min-w-0">
          <H id={id} className="font-display text-[1.08rem] font-semibold leading-tight tracking-tight">{title}</H>
          {hint && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ className, children, label }: { className?: string; children: React.ReactNode; label?: string }) {
  return (
    <section aria-labelledby={label} className={cn("cx-panel rounded-[28px] p-5 sm:p-6", className)}>
      {children}
    </section>
  );
}

function Avatar({ person, size = "sm" }: { person: Pick<Recent, "id" | "name" | "email">; size?: "sm" | "lg" }) {
  return (
    <span
      aria-hidden
      data-tone={toneFor(person.id)}
      className={cn(
        "cx-avatar grid shrink-0 place-items-center rounded-full font-display font-semibold",
        size === "lg" ? "size-20 text-[1.6rem]" : "size-9 text-[12.5px]",
      )}
    >
      {initials(person.name, person.email)}
    </span>
  );
}

function DeltaPill({ value, children }: { value: number | null; children: React.ReactNode }) {
  const tone = value === null ? "flat" : value > 0 ? "up" : value < 0 ? "down" : "flat";
  return <span data-tone={tone} className="cx-delta inline-flex h-7 items-center whitespace-nowrap rounded-full px-3 text-[12px] font-semibold tabular-nums">{children}</span>;
}

/** Header: the title, the three newest sign-ups as chips and how this week compares with last. */
export function CustomerHead({ recent, summary, body, actions }: { recent: Recent[]; summary: Summary; body: string; actions?: React.ReactNode }) {
  const d = weekDelta(summary.new7, summary.prev7);
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-2 text-[11px]">Run · Users</p>
          <h1 className="font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold leading-tight tracking-[-0.03em]">Customer information</h1>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">{body}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {recent.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <span className="mr-1 text-[12.5px] font-medium text-muted-foreground">Newest sign-ups</span>
          <ul className="flex flex-wrap items-center gap-2">
            {recent.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/users?q=${encodeURIComponent(p.email)}`}
                  scroll={false}
                  className="cx-chip inline-flex min-h-11 items-center gap-2.5 rounded-full py-1 pl-1 pr-4"
                >
                  <Avatar person={p} />
                  <span className="leading-tight">
                    <span className="block text-[13px] font-semibold">{firstName(p.name, p.email)}</span>
                    <span className="block text-[11.5px] text-muted-foreground">joined {ago(p.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <DeltaPill value={d}>
            {d === null ? `${nf(summary.new7)} new this week` : `${d > 0 ? "+" : ""}${d}% sign-ups vs last week`}
          </DeltaPill>
        </div>
      )}
    </header>
  );
}

type Tile = { tone: TileTone; icon: LucideIcon; label: string; value: number; line: string; href: string; go: string };

/** Six pastel tiles with real counts. Each opens the list already filtered to those people. */
export function SummaryPanel({ s }: { s: Summary }) {
  const d = weekDelta(s.new7, s.prev7);
  const dormant = Math.max(0, s.total - s.active7);
  const tiles: Tile[] = [
    { tone: "tan", icon: Users, label: "All customers", value: s.total, line: `+${nf(s.new7)} joined in the last 7 days`, href: "/admin/users", go: "Show everyone" },
    { tone: "blue", icon: CreditCard, label: "Paying", value: s.paying, line: `${pct(s.paying, s.total)}% of customers are on a paid plan`, href: "/admin/users?f=paying", go: "Show paying customers" },
    { tone: "lilac", icon: Activity, label: "Active this week", value: s.active7, line: `${pct(s.active7, s.total)}% used Outlly in the last 7 days`, href: "/admin/users?f=active", go: "Show active customers" },
    {
      tone: "salmon", icon: UserPlus, label: "New this week", value: s.new7,
      line: d === null ? `${nf(s.prev7)} the week before` : `${d > 0 ? "+" : ""}${d}% compared to the week before (${nf(s.prev7)})`,
      href: "/admin/users?joined=7", go: "Show this week's sign-ups",
    },
    { tone: "pink", icon: MoonStar, label: "Dormant", value: dormant, line: `${pct(dormant, s.total)}% quiet for 7 days or more`, href: "/admin/users?f=dormant", go: "Show dormant customers" },
    { tone: "rose", icon: Award, label: "Founding members", value: s.founding, line: `${pct(s.founding, s.total)}% of customers hold a founding number`, href: "/admin/users?tag=founding", go: "Show founding members" },
  ];
  return (
    <Panel label="cx-summary">
      <PanelHead
        id="cx-summary"
        icon={BarChart3}
        title="Customer summary"
        hint="Every account, whatever the list below is filtered to"
        actions={<RoundLink href="/admin/growth" label="Open growth" icon={ArrowUpRight} />}
      />
      <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link href={t.href} scroll={false} aria-label={`${t.label}: ${nf(t.value)}. ${t.go}`} data-tone={t.tone} className="cx-tile group flex h-full flex-col rounded-[22px] p-4">
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2.5">
                  <span aria-hidden className="cx-tile-chip grid size-8 place-items-center rounded-full"><t.icon className="size-4" strokeWidth={1.9} /></span>
                  <span className="text-[13px] font-semibold">{t.label}</span>
                </span>
                <span aria-hidden className="cx-tile-go grid size-8 place-items-center rounded-full"><ArrowUpRight className="size-4" strokeWidth={1.9} /></span>
              </span>
              <span className="mt-5 font-display text-[2.1rem] font-bold leading-none tracking-[-0.03em] tabular-nums">{nf(t.value)}</span>
              <span className="mt-2 text-[12px] leading-snug opacity-80">{t.line}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** "Valuable customer" milestones: how far people get through setup, each step linking to who is stuck. */
export function MilestonePanel({ s }: { s: Summary }) {
  const done = pct(s.setUp, s.total);
  const steps = [
    { icon: MailCheck, label: "Proved their email", n: s.verified, href: "/admin/users?tag=unverified", go: "Show who has not" },
    { icon: Link2, label: "Connected an account", n: s.connected, href: "/admin/users?tag=noaccounts", go: "Show who has nothing connected" },
    { icon: PenLine, label: "Made a post", n: s.posted, href: "/admin/users?tag=noposts", go: "Show who never posted" },
    { icon: ShieldCheck, label: "Turned on two-step sign-in", n: s.twoStep, href: "/admin/users?tag=no2fa", go: "Show who has it off" },
  ];
  return (
    <Panel label="cx-milestones">
      <PanelHead id="cx-milestones" icon={Flag} title="Getting set up" hint="Connected an account and made a post" />
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[1.9rem] font-bold leading-none tabular-nums">{done}%</span>
        <span className="text-[12.5px] text-muted-foreground">{nf(s.setUp)} of {nf(s.total)} customers</span>
      </div>
      <div role="progressbar" aria-label="Customers fully set up" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done} className="cx-track mt-3 h-3 overflow-hidden rounded-full">
        <span className="cx-fill block h-full rounded-full" style={{ width: `${done}%` }} />
      </div>
      <ul className="mt-5 divide-y divide-[hsl(var(--cx-line))]">
        {steps.map((st) => {
          const p = pct(st.n, s.total);
          const tone = p >= 75 ? "ok" : p >= 40 ? "mid" : "low";
          return (
            <li key={st.label} className="flex items-center gap-3 py-2.5">
              <span aria-hidden className="cx-icon grid size-9 shrink-0 place-items-center rounded-full"><st.icon className="size-4" strokeWidth={1.8} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium">{st.label}</span>
                <span className="block text-[12px] text-muted-foreground tabular-nums">{nf(st.n)} of {nf(s.total)}</span>
              </span>
              <span data-tone={tone} className="cx-status inline-flex h-7 items-center rounded-full px-3 text-[12px] font-semibold tabular-nums">{p}%</span>
              <RoundLink href={st.href} label={st.go} icon={Search} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** The newest sign-up as a profile card, then their details as labelled rows. */
export function ProfilePanel({ p }: { p: Recent | null }) {
  if (!p) {
    return (
      <Panel label="cx-profile">
        <PanelHead id="cx-profile" icon={User} title="Newest customer" />
        <p className="text-[13.5px] text-muted-foreground">Sign-ups appear here as soon as someone creates an account.</p>
      </Panel>
    );
  }
  const place = placeLabel(p.loc);
  const known = p.platforms.filter((x): x is Platform => x in PLATFORM_META);
  const rows: { icon: LucideIcon; label: string; value: React.ReactNode }[] = [
    { icon: User, label: "Full name", value: p.name || "Not given" },
    { icon: Mail, label: "Email", value: <span className="break-all">{p.email}</span> },
    { icon: Layers, label: "Plan", value: p.plan ?? "Free" },
    {
      icon: Link2,
      label: "Connected",
      value: known.length ? (
        <span className="flex flex-wrap items-center gap-1.5">
          {known.map((x) => <PlatformOrb key={x} platform={x} size={22} />)}
          <span className="sr-only">{known.map((x) => PLATFORM_META[x].name).join(", ")}</span>
        </span>
      ) : "Nothing connected yet",
    },
    { icon: MapPin, label: "Location (approximate)", value: place ? `≈ ${place}` : "Unknown" },
    { icon: Clock, label: "Last seen", value: p.seenAt ? ago(p.seenAt) : "Not since signing up" },
  ];
  return (
    <>
      <Panel label="cx-profile" className="text-center">
        <h2 id="cx-profile" className="sr-only">Newest customer</h2>
        <p className="eyebrow text-[11px]">Newest customer</p>
        <div className="mt-4 flex justify-center"><Avatar person={p} size="lg" /></div>
        <p className="mt-3 font-display text-[1.25rem] font-semibold leading-tight tracking-tight">{p.name || firstName(p.name, p.email)}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{p.plan ? `${p.plan} plan` : "Free plan"} · joined {fmtDate(p.createdAt)}</p>
        <div className="mt-4 flex justify-center gap-2">
          <RoundLink href={`mailto:${p.email}`} label={`Email ${firstName(p.name, p.email)}`} icon={Mail} />
          <RoundLink href={`/admin/users?q=${encodeURIComponent(p.email)}`} label="Find them in the list" icon={Search} />
          <RoundLink href="/admin/users?joined=7" label="Everyone who joined this week" icon={UserPlus} />
        </div>
      </Panel>
      <Panel label="cx-details">
        <PanelHead id="cx-details" icon={User} title="Detailed information" as="h3" />
        <dl className="divide-y divide-[hsl(var(--cx-line))]">
          {rows.map((r) => (
            <div key={r.label} className="relative min-w-0 py-2.5 pl-12">
              <dt className="text-[11.5px] text-muted-foreground">
                <span aria-hidden className="cx-icon absolute left-0 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full"><r.icon className="size-4" strokeWidth={1.8} /></span>
                {r.label}
              </dt>
              <dd className="text-[13.5px] font-medium [overflow-wrap:anywhere]">{r.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      {/* R1209: opens on this customer; the email box looks up anyone else. */}
      <StoragePanel userId={p.id} />
    </>
  );
}

/** Active subscriptions per plan as gradient bars, plus everyone on Free. */
export function PlanMixPanel({ s }: { s: Summary }) {
  const free = Math.max(0, s.total - s.paying);
  const rows = [...s.plans.filter((p) => p.count > 0), { name: "Free", count: free }];
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel label="cx-plans">
      <PanelHead id="cx-plans" icon={Layers} title="Plan mix" hint="Active subscriptions today" actions={<RoundLink href="/admin/subscriptions" label="Open subscriptions" icon={ArrowUpRight} />} />
      <ul className="space-y-3.5">
        {rows.map((r, i) => (
          <li key={r.name}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-medium">{r.name}</span>
              <span className="tabular-nums text-muted-foreground">{nf(r.count)} · {pct(r.count, s.total)}%</span>
            </div>
            <div aria-hidden className="cx-track h-2.5 overflow-hidden rounded-full">
              <span data-tone={TONES[i % TONES.length]} className="cx-bar block h-full rounded-full" style={{ width: `${Math.max(r.count ? 4 : 0, (r.count / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
