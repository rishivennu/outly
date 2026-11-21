import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { MineApplication } from "@/lib/partners/mine-types";
import { fmtDay } from "@/lib/partners/offer-core";
import { activityTitle, countLabel, dayLabel, handleLabel, LIST_PATH, NOT_PROVIDED, nicheLabel, platformLabel, preferenceLabel } from "./model";
import { StatusPill } from "./StatusPill";
import { Timeline } from "./Timeline";
import { MoreInfoPanel } from "./MoreInfoPanel";
import { OfferCard } from "./OfferCard";
import { ActivePartnership } from "./ActivePartnership";
import { Withdraw } from "./Withdraw";

const CARD = "rounded-[24px] border border-foreground/[0.08] bg-card p-5 sm:p-6";
const ACTIVE = new Set(["offer_accepted", "active", "completed"]);

function Row({ term, value }: { term: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-[15px] [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Summary({ app }: { app: MineApplication }) {
  const note = typeof app.proposal?.extra === "string" ? app.proposal.extra : typeof app.proposal?.note === "string" ? app.proposal.note : "";
  return (
    <section aria-labelledby="pp-sum-h" className={CARD}>
      <h2 id="pp-sum-h" className="mb-4 text-[17px] font-semibold">Your application</h2>
      <dl className="divide-y divide-foreground/[0.08]">
        <Row term="Name" value={app.fullName || NOT_PROVIDED} />
        <Row term="Country" value={app.country || NOT_PROVIDED} />
        <Row
          term="Platforms"
          value={
            app.socials.length ? (
              <ul className="grid gap-1.5">
                {app.socials.map((s, i) => (
                  <li key={`${s.platform}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{platformLabel(s.platform)}</span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-muted-foreground underline-offset-4 hover:underline">{handleLabel(s.handle) || s.url}</a>
                    ) : (
                      <span className="text-muted-foreground">{handleLabel(s.handle) || NOT_PROVIDED}</span>
                    )}
                    <span className="text-[13px] tabular-nums text-muted-foreground">{countLabel(s.followers)} followers</span>
                    {s.primary && app.socials.length > 1 && <span className="text-[12px] text-muted-foreground">(primary)</span>}
                  </li>
                ))}
              </ul>
            ) : (
              NOT_PROVIDED
            )
          }
        />
        <Row term="Followers" value={<span className="tabular-nums">{countLabel(app.followers)}</span>} />
        <Row term="Average views" value={<span className="tabular-nums">{countLabel(app.avgViews)}</span>} />
        {app.engagementRate !== null && app.engagementRate > 0 && <Row term="Engagement rate" value={<span className="tabular-nums">{app.engagementRate}%</span>} />}
        <Row term="Category" value={nicheLabel(app.niche) || NOT_PROVIDED} />
        <Row term="Preference" value={preferenceLabel(app.preference) || NOT_PROVIDED} />
        {note && <Row term="Your note" value={<span className="whitespace-pre-line">{note}</span>} />}
      </dl>
      <p className="mt-4 text-[12px] text-muted-foreground">Audience numbers are self-reported.</p>
    </section>
  );
}

function Activity({ app }: { app: MineApplication }) {
  const list = [...app.events].sort((a, b) => (a.at < b.at ? 1 : -1));
  if (!list.length) return null;
  return (
    <section aria-labelledby="pp-act-h" className={CARD}>
      <h2 id="pp-act-h" className="mb-4 text-[17px] font-semibold">Activity</h2>
      <ol className="grid gap-3">
        {list.map((e, i) => (
          <li key={`${e.at}-${i}`} className="min-w-0">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px] font-medium">
              <span>{activityTitle(e)}</span>
              <time dateTime={e.at} className="text-[12px] font-normal tabular-nums text-muted-foreground">{fmtDay(e.at)}</time>
            </p>
            {e.message && <p className="mt-0.5 whitespace-pre-line text-[14px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{e.message}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PartnershipDetail({ app }: { app: MineApplication }) {
  const ask = app.status === "more_info" ? app.infoRequest : null;
  const info = ask && !ask.respondedAt ? ask : null;
  const answered = ask?.respondedAt ?? null;
  const pending = app.offer && app.offer.status === "sent" ? app.offer : null;
  return (
    <div className="page-frame pb-20 pt-6 lg:pt-10">
      <Link href={LIST_PATH} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[14px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> My Partnerships
      </Link>
      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">Application ID</p>
          <h1 className="font-mono text-[clamp(1.6rem,4vw,2.2rem)] font-semibold leading-tight">{app.ref}</h1>
          <p className="mt-2 text-[13px] tabular-nums text-muted-foreground">
            Submitted {dayLabel(app.createdAt)}. Last update {dayLabel(app.lastStatusAt || app.updatedAt)}.
          </p>
        </div>
        <StatusPill status={app.status} className="text-[13px]" />
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        <div className="grid min-w-0 gap-5">
          {answered && (
            <p role="status" className="rounded-[24px] border border-foreground/[0.08] bg-card px-5 py-4 text-[14px] leading-relaxed text-muted-foreground">
              Your update was sent on {fmtDay(answered)}. The team will review it and let you know.
            </p>
          )}
          {info && <MoreInfoPanel appRef={app.ref} request={info} socials={app.socials} avgViews={app.avgViews} />}
          {pending && <OfferCard appRef={app.ref} offer={pending} />}
          {ACTIVE.has(app.status) && <ActivePartnership appRef={app.ref} status={app.status} offer={app.offer} benefit={app.benefit} deliverables={app.deliverables} partnerCode={app.partnerCode} />}
          <Summary app={app} />
          <Activity app={app} />
          {app.nextAction.kind === "withdraw" && <Withdraw appRef={app.ref} />}
        </div>
        {/* On a phone the progress reads first unless something needs an answer (an offer, a question, live deliverables); on desktop it sits beside the work. */}
        <div className={`${info || pending || ACTIVE.has(app.status) ? "order-none" : "order-first"} grid min-w-0 gap-5 lg:sticky lg:top-6 lg:order-none`}>
          <section aria-labelledby="pp-tl-h" className={CARD}>
            <h2 id="pp-tl-h" className="mb-5 text-[17px] font-semibold">Progress</h2>
            <Timeline app={app} />
          </section>
        </div>
      </div>
    </div>
  );
}
