import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { PageHead, Shell } from "@/components/marketing/bits";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Status",
  description: "Whether Outlly is up right now, checked live, with links to the status pages of the platforms Outlly publishes to.",
  alternates: { canonical: "/status" },
  openGraph: { title: "Status · Outlly", description: "Whether Outlly is up right now.", url: "/status" },
};

// Checked again at most once a minute, so a busy status page can't load the database.
export const revalidate = 60;

const DB_TIMEOUT_MS = 3000;

type Check = { name: string; ok: boolean; detail: string };

/** The same ping as /api/health: one `SELECT 1`, timed, given up after 3 s. */
async function databaseCheck(): Promise<Check> {
  const t = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([db.$queryRaw`SELECT 1`, new Promise((_, no) => (timer = setTimeout(() => no(new Error("timeout")), DB_TIMEOUT_MS)))]);
    return { name: "Database", ok: true, detail: `Answered in ${Math.max(1, Math.round(performance.now() - t))} ms.` };
  } catch {
    return { name: "Database", ok: false, detail: "Not answering. Sign-in, publishing and your studio may not work until it is back." };
  } finally {
    clearTimeout(timer);
  }
}

/** Official status pages only, each opened and confirmed before it was listed here. */
const PLATFORM_STATUS = [
  { names: "Instagram and Facebook", href: "https://metastatus.com", label: "Meta Status" },
  { names: "LinkedIn", href: "https://www.linkedin-status.com", label: "LinkedIn Status" },
  { names: "X", href: "https://docs.x.com/status", label: "X API status" },
];
/** Outlly publishes here too, but we found no official public status page to link to. */
const NO_STATUS_PAGE = "YouTube, TikTok and Threads";

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

export default async function StatusPage() {
  const checkedAt = new Date();
  const checks: Check[] = [{ name: "Website", ok: true, detail: "Up: the app built this page." }, await databaseCheck()];
  const down = checks.filter((c) => !c.ok);
  const time = checkedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
  return (
    <section className="py-16 sm:py-24">
      <Shell>
        <PageHead title="Status" lead="Checked live by the app itself, at most once a minute. No made-up uptime numbers: just what answered on this check." />

        <div role="status" className="mt-12 flex max-w-[62ch] items-start gap-3 rounded-[1.75rem] border border-border p-6">
          {down.length === 0 ? (
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success-ink" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <div>
            <p className="text-xl font-semibold tracking-tight">{down.length === 0 ? "All systems operational" : `${down.map((c) => c.name).join(" and ")} ${down.length === 1 ? "is" : "are"} down`}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Checked at <time dateTime={checkedAt.toISOString()}>{time} UTC</time>. Reload to check again.
            </p>
          </div>
        </div>

        <ul className="mt-6 max-w-[62ch] divide-y divide-border rounded-[1.75rem] border border-border">
          {checks.map((c) => (
            <li key={c.name} className="flex items-start gap-3 p-5">
              <span className={c.ok ? "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-success" : "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-destructive"} aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  {c.name} <span className={c.ok ? "font-medium text-success-ink" : "font-medium text-destructive"}>{c.ok ? "Up" : "Down"}</span>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-16 max-w-[62ch]">
          <h2 className="text-[1.35rem] font-semibold tracking-tight">The platforms Outlly publishes to</h2>
          <p className="mt-3 text-pretty text-base leading-relaxed text-muted-foreground">
            When a platform has a problem, posts to it can fail or wait even while Outlly is up. Their own status pages say what is happening on their side.
          </p>
          <ul className="mt-6 flex flex-col gap-2">
            {PLATFORM_STATUS.map((p) => (
              <li key={p.href}>
                <a href={p.href} {...ext} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]">
                  {p.names}: {p.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">{NO_STATUS_PAGE} don&rsquo;t have an official public status page we can link to.</p>
        </div>
      </Shell>
    </section>
  );
}
