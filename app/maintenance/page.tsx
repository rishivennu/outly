import { redirect } from "next/navigation";
import { CalendarClock, ShieldCheck, Wrench } from "lucide-react";
import { Pip } from "@/components/brand/Pip";
import { OutlyLogo } from "@/components/brand/Logo";
import { siteStatus } from "@/lib/site";
import { NotifyForm } from "@/components/maintenance/NotifyForm";
import { cn } from "@/lib/utils";

export const metadata = { title: "Back soon", robots: { index: false } };
export const dynamic = "force-dynamic";

const Kicker = ({ children }: { children: React.ReactNode }) => <p className="text-[13px] font-semibold text-[hsl(var(--ap-ink2))]">{children}</p>;

function ago(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return "Started just now";
  if (m < 60) return `Started ${m} min ago`;
  const h = Math.round(m / 60);
  return `Started ${h} hour${h === 1 ? "" : "s"} ago`;
}

/** Shown to everyone except signed-in admins while the admin switch is on. Same bento language as the waitlist. */
export default async function Maintenance() {
  const s = await siteStatus();
  if (!s.maintenance) redirect("/");
  const started = s.since ? ago(s.since) : "";
  return (
    <main id="main" className="ap-canvas min-h-dvh px-5 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-[1000px]">
        <div className="flex justify-center">
          <OutlyLogo size={28} />
        </div>

        <ul className="mt-10 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          <li className="ap-tile wl-rise relative overflow-hidden p-6 text-center sm:col-span-2 sm:p-10 lg:row-span-2">
            <div aria-hidden className="pointer-events-none absolute inset-0 [background:radial-gradient(70%_55%_at_50%_0%,hsl(var(--lime)/0.18),transparent_70%)]" />
            <div className="relative flex h-full flex-col items-center justify-center">
              <Pip size={112} mood="think" />
              <p className="mt-6 text-[14px] font-semibold text-[hsl(var(--ap-ink2))]">Scheduled maintenance</p>
              <h1 className="display mt-2 text-balance text-[clamp(2.1rem,5.5vw,3.25rem)]">
                We&apos;re tuning
                <span className="block text-[hsl(var(--ap-ink2))]">things up.</span>
              </h1>
              <p className="mt-4 max-w-[30rem] text-pretty text-[16px] leading-relaxed text-[hsl(var(--ap-ink2))]">
                {s.message || "Outlly is down for a short upgrade. We'll be back before long."}
              </p>
            </div>
          </li>

          <li className="ap-tile wl-rise flex flex-col p-6 sm:col-span-2 sm:p-7" style={{ animationDelay: ".06s" }}>
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-[hsl(var(--ap-ink2))]">
              <span className="live-dot" style={{ background: "hsl(var(--lime))" }} aria-hidden="true" /> Upgrade in progress
            </span>
            <p className="mt-auto pt-6 font-display text-[clamp(2rem,4.5vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em]">
              {s.eta ? (
                <>
                  <span className="block text-[15px] font-semibold tracking-normal text-[hsl(var(--ap-ink2))]">Expected back</span>
                  {s.eta}
                </>
              ) : (
                "Back shortly."
              )}
            </p>
            {started && <p className="mt-2 text-[14px] text-[hsl(var(--ap-ink2))]">{started}</p>}
          </li>

          <li className="ap-tile wl-rise p-6" style={{ animationDelay: ".1s" }}>
            <ShieldCheck className="h-6 w-6 text-[hsl(var(--ap-ink2))]" aria-hidden="true" />
            <p className="mt-3 font-display text-[21px] font-bold leading-[1.15] tracking-[-0.02em]">Your posts and media are safe.</p>
          </li>

          <li className="ap-tile wl-rise p-6" style={{ animationDelay: ".14s" }}>
            <CalendarClock className="h-6 w-6 text-[hsl(var(--ap-ink2))]" aria-hidden="true" />
            <p className="mt-3 font-display text-[21px] font-bold leading-[1.15] tracking-[-0.02em]">Anything due goes out once we&apos;re back.</p>
          </li>

          <li className={cn("ap-tile wl-rise grid gap-6 p-6 sm:col-span-2 sm:p-8 lg:col-span-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-center")} style={{ animationDelay: ".18s" }}>
            <div>
              <Kicker>
                <Wrench className="mr-1.5 inline h-4 w-4 align-[-3px]" aria-hidden="true" />
                Want a nudge?
              </Kicker>
              <h2 className="mt-1 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-bold leading-[1.1] tracking-[-0.025em]">We&apos;ll email you the moment we&apos;re back.</h2>
            </div>
            <NotifyForm />
          </li>
        </ul>
      </div>
    </main>
  );
}
