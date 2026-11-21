import Link from "next/link";
import { ExternalLink, FileText, ImageIcon } from "lucide-react";
import { Card, CardTitle, Pill, fmtDate } from "@/components/admin/ui";
import { POSTING_FREQUENCY_LABEL, type PartnerProposal, type PartnerSocial, type PartnerStats, type PostingFrequency } from "@/lib/partners/types";
import ActionBar from "./ActionBar";
import NotesPanel, { type PartnerNoteRow } from "./NotesPanel";
import HistoryList, { type PartnerEventRow } from "./HistoryList";
import AttributionCard from "./AttributionCard";
import OfferEditor from "./OfferEditor";
import DeliverablesPanel from "./DeliverablesPanel";
import { PlatformMark, fmtCount, fmtRate, fmtWhole, formatLabel, nicheLabel, platformLabel, preferenceLabel } from "./bits";
import { fmtHandle } from "@/lib/handle";

export type PartnerDetailData = {
  id: string; ref: string; status: string; fullName: string; email: string; country: string; city: string; phone: string; brandName: string;
  userId: string | null; tier: string; preference: string; partnerCode: string | null; termsVersion: string; consentAt: string; source: string; createdAt: string;
  socials: PartnerSocial[]; stats: Partial<PartnerStats>; proposal: Partial<PartnerProposal>;
  files: { id: string; name: string; mime: string; size: number; createdAt: string }[];
  notes: PartnerNoteRow[]; events: PartnerEventRow[];
  attribution: { visits: number; signups: number; paid: number };
};

function Facts({ items, missing = "Not given" }: { items: [string, React.ReactNode][]; missing?: string }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[12px] font-semibold text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 text-[14px] [overflow-wrap:anywhere]">{v || <span className="text-muted-foreground">{missing}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

const sizeLabel = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const safeHttp = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null;
  } catch {
    return null;
  }
};

/** R1289: a short application leaves most figures out on purpose; absent reads "Not provided", never a zero. */
const opt = (n: unknown, f: (n: number) => string) => (typeof n === "number" && Number.isFinite(n) ? f(n) : "");

/** Admin detail of one creator application: what they sent on the left, what the team does on the right. */
export function PartnerDetail({ app }: { app: PartnerDetailData }) {
  const s = app.stats;
  const p = app.proposal;
  const portfolio = (p.portfolio ?? []).map((u) => ({ raw: u, href: safeHttp(u) }));
  const short = (p as { form?: unknown }).form === "short";
  const extra = typeof (p as { extra?: unknown }).extra === "string" ? ((p as { extra?: string }).extra ?? "") : "";
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 content-start gap-4">
        <Card>
          <CardTitle action={short ? <Pill tone="lime">Short application</Pill> : undefined}>Personal</CardTitle>
          <Facts
            items={[
              ["Full name", app.fullName],
              ["Email", <a key="e" href={`mailto:${app.email}`} className="underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">{app.email}</a>],
              ["Phone", app.phone],
              ["Location", [app.city, app.country].filter(Boolean).join(", ")],
              ["Brand or channel name", app.brandName],
              ["Outlly account", app.userId ? <Link key="u" href={`/admin/users?q=${encodeURIComponent(app.email)}`} className="underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">Find in Users</Link> : "No account with this email"],
              ["Came from", app.source],
              ["Terms accepted", `${fmtDate(app.consentAt, true)} (version ${app.termsVersion})`],
            ]}
          />
        </Card>

        <Card>
          <CardTitle hint="As entered by the creator.">Social accounts</CardTitle>
          {app.socials.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No accounts listed.</p>
          ) : (
            <ul className="grid gap-2.5">
              {app.socials.map((a, i) => {
                const href = safeHttp(a.url);
                return (
                  <li key={`${a.platform}-${a.handle}-${i}`} className="rounded-2xl bg-secondary/40 p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <PlatformMark platform={a.platform} />
                      <span className="text-[13px] font-semibold">{platformLabel(a.platform)}</span>
                      {a.primary && <Pill tone="lime">Primary</Pill>}
                    </div>
                    <p className="mt-1 text-[14px]">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener nofollow noreferrer" className="inline-flex min-h-[44px] items-center gap-1 underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground sm:min-h-0">
                          {fmtHandle(a.handle)}
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      ) : (
                        <>{fmtHandle(a.handle)}</>
                      )}
                    </p>
                    <p className="mt-1 text-[12.5px] text-muted-foreground">
                      {fmtWhole(a.followers)} followers · {nicheLabel(a.niche)} · {formatLabel(a.format)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle hint="Creator-provided. Not verified by Outlly.">Performance</CardTitle>
          <Facts
            missing="Not provided"
            items={[
              ["Average views (creator-provided)", opt(s.avgViews, fmtWhole)],
              ["Average likes (creator-provided)", opt(s.avgLikes, fmtWhole)],
              ["Average comments (creator-provided)", opt(s.avgComments, fmtWhole)],
              ["Average shares (creator-provided)", opt(s.avgShares, fmtWhole)],
              ["Reach per post (creator-provided)", opt(s.reach, fmtCount)],
              ["Engagement rate (creator-provided)", opt(s.engagementRate, fmtRate)],
              ["Audience countries (creator-provided)", s.audienceCountries],
              ["Audience age (creator-provided)", s.ageRange],
              ["Posting frequency (creator-provided)", s.frequency ? POSTING_FREQUENCY_LABEL[s.frequency as PostingFrequency] ?? s.frequency : ""],
              ["Main niche (creator-provided)", s.niche ? nicheLabel(s.niche) : ""],
            ]}
          />
        </Card>

        <Card>
          <CardTitle hint="Opens in a new tab. Only signed-in admins can open these.">Attachments</CardTitle>
          {app.files.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No files attached.</p>
          ) : (
            <ul className="grid gap-2">
              {app.files.map((f) => (
                <li key={f.id}>
                  <a
                    href={`/api/admin/partners/${app.id}/files/${f.id}`}
                    target="_blank"
                    rel="noopener"
                    className="flex min-h-[44px] items-center gap-3 rounded-2xl bg-secondary/40 px-3.5 py-2 hover:bg-secondary/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]"
                  >
                    {f.mime === "application/pdf" ? <FileText className="h-4 w-4 shrink-0" aria-hidden /> : <ImageIcon className="h-4 w-4 shrink-0" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate text-[13.5px]" title={f.name}>{f.name}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{sizeLabel(f.size)}</span>
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Proposal</CardTitle>
          <div className="grid gap-4">
            {([["Why Outlly", p.why], ["How they would promote it", p.how], ["Content type", p.contentType], ...(extra ? [["Anything else", extra]] : [])] as const).map(([k, v]) => (
              <div key={k}>
                <h3 className="text-[12px] font-semibold text-muted-foreground">{k}</h3>
                <p className="mt-0.5 whitespace-pre-wrap text-[14px] leading-relaxed [overflow-wrap:anywhere]">{v || <span className="text-muted-foreground">{short ? "Not provided" : "Not given"}</span>}</p>
              </div>
            ))}
            <Facts
              missing={short ? "Not provided" : "Not given"}
              items={[
                ["Posts offered", typeof p.posts === "number" ? fmtWhole(p.posts) : ""],
                ["Preference", preferenceLabel(p.preference ?? app.preference)],
                ["Expected compensation", p.compensation],
                ["Past collaborations", p.pastCollabs],
              ]}
            />
            <div>
              <h3 className="text-[12px] font-semibold text-muted-foreground">Portfolio links</h3>
              {portfolio.length === 0 ? (
                <p className="mt-0.5 text-[14px] text-muted-foreground">Not given</p>
              ) : (
                <ul className="mt-1 grid gap-1">
                  {portfolio.map((l, i) => (
                    <li key={i} className="min-w-0 text-[14px] [overflow-wrap:anywhere]">
                      {l.href ? (
                        <a href={l.href} target="_blank" rel="noopener nofollow noreferrer" className="underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">
                          {l.raw}<span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        l.raw
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 content-start gap-4">
        <ActionBar id={app.id} status={app.status} />
        <NotesPanel id={app.id} notes={app.notes} />
        <section id="offers" aria-label="Offers" className="min-w-0 scroll-mt-24">
          <OfferEditor applicationId={app.id} status={app.status} email={app.email} />
        </section>
        <section aria-label="Deliverables" className="min-w-0">
          <DeliverablesPanel applicationId={app.id} status={app.status} email={app.email} />
        </section>
        <AttributionCard id={app.id} status={app.status} code={app.partnerCode} counts={app.attribution} />
        <HistoryList events={app.events} />
      </div>
    </div>
  );
}
