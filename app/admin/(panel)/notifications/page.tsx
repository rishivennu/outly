import { requireAdmin } from "@/lib/admin/guard";
import { getAdmin } from "@/lib/admin/auth";
import { notifyConfig } from "@/lib/notify-config";
import { failedDeliveries, filtersOn, notifyAudit, notifyOverview, parseQueueFilters, recentDeliveries, searchDeadLetters, searchQueue } from "@/lib/admin/notifications";
import { MAX_ATTEMPTS } from "@/lib/notify-engine";
import { Card, CardTitle, Empty, Hint, PageHead, StatusBadge, Table, ago, fmtDate } from "@/components/admin/ui";
import { adminEmail, canSeeEmail } from "@/lib/admin/privacy";
import { EnterRoot } from "@/components/admin/motion/EnterRoot";
import { RollingNumber } from "@/components/dashboard/RollingNumber";
import { NotificationsPanel } from "@/components/admin/NotificationsPanel";
import { QueueFilterBar } from "@/components/admin/notifications/QueueFilters";
import { RetryButton } from "@/components/admin/notifications/RetryButton";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const REASON: Record<string, string> = {
  event_off: "the creator switched that event off",
  inapp_off: "the creator switched the bell off",
  push_off: "push is off for them",
  email_off: "email is off for them",
  quiet_hours: "quiet hours",
  cooldown: "held back by a cooldown",
  paused: "notifications were paused",
  no_device: "no phone or computer is connected",
  push_error: "the push service refused it",
  email_error: "the email provider refused it",
  dead_letter: "it failed four times and was given up on",
};
const reason = (r: string | null) => (r ? REASON[r] ?? r : "");

export default async function AdminNotificationsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("site");
  const admin = await getAdmin();
  const role = admin?.role ?? "support";
  const f = parseQueueFilters(await props.searchParams);
  const filtered = filtersOn(f);
  const [cfg, over, failed, dead, queue, log, audit] = await Promise.all([notifyConfig(), notifyOverview(), failedDeliveries(), searchDeadLetters(f), searchQueue(f), recentDeliveries(40), notifyAudit()]);
  const who = (email: string | null, id: string | null) => (email ? adminEmail(email, role) : id ? "Account deleted" : "Unknown");
  const sent = over.channels.reduce((s, c) => s + c.sent, 0);
  const held = over.channels.reduce((s, c) => s + c.skipped, 0);
  const broke = over.channels.reduce((s, c) => s + c.failed, 0);
  const n = over.counts;
  const plural = (v: number, one: string, many = `${one}s`) => `${v.toLocaleString("en-IN")} ${v === 1 ? one : many}`;
  const channelName = (c: string) => (c === "inapp" ? "Bell" : c === "fcm" ? "App (Android)" : c === "push" ? "Web push" : c === "email" ? "Email" : c);

  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Notifications"
        body={`Everything Outlly says to creators, and why. The last ${over.days} days unless a card says otherwise.`}
      />

      <EnterRoot>
        <div className="mb-3 grid grid-cols-1 gap-3 min-[440px]:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Notifications", v: n.notifications, sub: `to ${plural(n.recipients, "creator")}, ${plural(n.attempts, "channel attempt")}`, hint: "One decision for one creator, however many channels it was tried on. A notification a creator already had is not counted again." },
            { label: "Reached someone", v: n.reached, sub: `${plural(sent, "attempt")} accepted by a channel`, hint: "Notifications where at least one channel accepted the message. Accepted means the bell row was written or the push or email provider said yes. It never means seen or opened." },
            { label: "Held back entirely", v: n.held, sub: `${plural(held, "attempt")} held back in all`, hint: "Notifications where every channel was held back: the creator's own switch, quiet hours, a cooldown, the global pause, or no device to send to. Not a fault." },
            { label: "Failed or waiting", v: n.failed + n.waiting, sub: `${plural(broke, "failed attempt")}, ${plural(over.queue.pending, "event")} in the queue${over.queue.retrying ? ` (${over.queue.retrying} retrying)` : ""}`, hint: "Notifications nothing accepted because a provider refused (failed) or because the push is still queued (waiting). Queue events are counted separately below." },
          ].map((s) => (
            <Card key={s.label} data-enter className="!p-5">
              <p className="flex items-center gap-1 text-[12.5px] font-semibold text-muted-foreground">
                {s.label}
                <Hint text={s.hint} label={`How ${s.label} is counted`} />
              </p>
              <RollingNumber value={s.v.toLocaleString("en-IN")} className="mt-1 block font-display text-[2rem] font-bold leading-none tabular" />
              <p className="mt-2 text-[12.5px] text-muted-foreground">{s.sub}</p>
            </Card>
          ))}
        </div>

        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <Card data-enter>
            <CardTitle hint={`Last ${over.days} days. "Held back" is not a fault: it is somebody's own setting, a quiet hour or a cooldown doing its job.`}>By channel</CardTitle>
            {over.channels.length === 0 ? (
              <Empty title="Nothing sent yet" body="Once notifications go out, every attempt and every skip is counted here." />
            ) : (
              <Table label="Channel attempts by channel" head={["Channel", "Attempts", "Accepted", "Held back", "Failed", "Waiting", "Last accepted"]}>
                {over.channels.map((c) => (
                  <tr key={c.channel}>
                    <td className="font-medium">{channelName(c.channel)}</td>
                    <td className="tabular">{c.total}</td>
                    <td className="tabular">{c.sent}</td>
                    <td className="tabular">{c.skipped}</td>
                    <td className="tabular">{c.failed}</td>
                    <td className="tabular">{c.queued}</td>
                    <td className="whitespace-nowrap text-[12.5px] text-muted-foreground">{c.lastSentAt ? ago(c.lastSentAt) : "never"}</td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              Every number is a channel attempt. Reachable right now: {over.subs.web.toLocaleString("en-IN")} browser subscription{over.subs.web === 1 ? "" : "s"} across {over.subs.people.toLocaleString("en-IN")} creator{over.subs.people === 1 ? "" : "s"}, {over.subs.fcm.toLocaleString("en-IN")} app device{over.subs.fcm === 1 ? "" : "s"}
              {over.subs.unhealthy > 0 ? `, ${over.subs.unhealthy} subscription${over.subs.unhealthy === 1 ? "" : "s"} failing` : ""}.
            </p>
          </Card>

          <Card data-enter>
            <CardTitle hint="Held-back channel attempts by the reason the engine recorded, most common first. These add up to the held-back attempts in the channel table. A long list of one reason is usually a setting worth rethinking rather than a bug.">Why things were held back</CardTitle>
            {over.reasons.length === 0 ? (
              <Empty title="Nothing held back" body="Every notification that was wanted went out." />
            ) : (
              <Table label="Skip reasons" head={["Reason", "Attempts"]}>
                {over.reasons.map((r) => (
                  <tr key={r.reason}>
                    <td>{reason(r.reason)}</td>
                    <td className="tabular">{r.count}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        {n.byCategory.length > 0 && (
          <Card data-enter className="mb-4">
            <CardTitle hint="A notification is one decision for one creator; a channel attempt is one channel's outcome for it (the bell, web push, the Android app or email). The attempt columns split each group's channel attempts by what happened. The attempt columns add up to the group's attempts, never to its notifications.">By group</CardTitle>
            <Table label="Notifications by group" head={["Group", "Notifications", "Attempts", "Accepted", "Held back", "Failed", "Waiting"]}>
              {n.byCategory.map((c) => (
                <tr key={c.id || "other"}>
                  <td className="font-medium">{n.titles[c.id] ?? c.id}</td>
                  <td className="tabular">{c.notifications}</td>
                  <td className="tabular">{c.attempts}</td>
                  <td className="tabular">{c.sent}</td>
                  <td className="tabular">{c.skipped}</td>
                  <td className="tabular">{c.failed}</td>
                  <td className="tabular">{c.queued}</td>
                </tr>
              ))}
            </Table>
          </Card>
        )}

        <div data-enter>
          <NotificationsPanel initial={cfg} adminLogin={admin?.login ?? ""} adminName={admin?.name ?? ""} audit={audit} />
        </div>

        <QueueFilterBar f={f} shown={`Up to ${f.limit} rows in each list · dates are UTC days`} />

        <div className="grid gap-3">
          <Card data-enter id="queue">
            <CardTitle hint={`Waiting their turn, urgent first. A try count above zero means a service turned it away and it will be tried again, up to ${MAX_ATTEMPTS} tries.`}>Queue</CardTitle>
            {!queue || queue.length === 0 ? (
              filtered ? (
                <Empty title="Nothing matches these filters." body={queue ? "Try a wider date range or a shorter search." : "Dead letters are not in the queue; they are listed in their own card below."} />
              ) : (
                <Empty title="The queue is empty" body="Events are turned into notifications by the minute sweeper." />
              )
            ) : (
              <Table label="Waiting events" head={["What", "Creator", "Tries", "Last error", "Next run"]}>
                {queue.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="block font-medium">{e.kind}</span>
                      {e.title && <span className="block max-w-[16rem] truncate text-[12.5px]" title={e.title}>{e.title}</span>}
                      <span className="block text-[12px] text-muted-foreground">Priority {e.priority} · {e.source}{e.email ? " · asks for email" : ""}</span>
                    </td>
                    <td>
                      <span className="block truncate text-[12.5px]">{who(e.userEmail, e.userId)}</span>
                      <span className="block truncate font-mono text-[11.5px] text-muted-foreground">{e.userId}</span>
                    </td>
                    <td className="tabular whitespace-nowrap">{e.attempts} of {MAX_ATTEMPTS}</td>
                    <td className="max-w-[18rem] truncate text-[12.5px]" title={e.lastError ?? undefined}>{e.lastError ?? <span className="text-muted-foreground">None</span>}</td>
                    <td className="whitespace-nowrap">{fmtDate(e.nextAt, true)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card data-enter id="dead-letters">
            <CardTitle
              hint={`Given up on after ${MAX_ATTEMPTS} tries. These were never delivered: the payload is kept so the same thing can be sent again once the cause is fixed. Retry puts it back in the queue with ${MAX_ATTEMPTS} fresh tries and runs it straight away. Every retry is written to the admin audit log.`}
              action={dead && dead.length > 0 ? <RetryButton ids={dead.map((d) => d.id)} /> : undefined}
            >
              Dead letters
            </CardTitle>
            {!dead || dead.length === 0 ? (
              filtered ? (
                <Empty title="Nothing matches these filters." body={dead ? "Try a wider date range or a shorter search." : "Only the Dead letters status lists given-up events; the queue above shows the rest."} />
              ) : (
                <Empty title="Nothing was given up on" body={`An event that fails ${MAX_ATTEMPTS} times lands here instead of disappearing.`} />
              )
            ) : (
              <Table label="Dead letters" head={["What", "Creator", "Tries", "Last error", "Next run", <span key="a" className="sr-only">Action</span>]}>
                {dead.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="block font-medium">{d.kind}</span>
                      {d.title && <span className="block max-w-[16rem] truncate text-[12.5px]" title={d.title}>{d.title}</span>}
                      <span className="block text-[12px] text-muted-foreground">{d.source}{d.email ? " · asks for email" : ""}</span>
                    </td>
                    <td>
                      <span className="block truncate text-[12.5px]">{who(d.userEmail, d.userId)}</span>
                      {d.userId && <span className="block truncate font-mono text-[11.5px] text-muted-foreground">{d.userId}</span>}
                    </td>
                    <td className="tabular whitespace-nowrap">{d.attempts} of {MAX_ATTEMPTS}</td>
                    <td className="max-w-[18rem] truncate text-[12.5px]" title={d.error}>{d.error || <span className="text-muted-foreground">None recorded</span>}</td>
                    <td className="whitespace-nowrap">
                      <span className="block">Not scheduled</span>
                      <span className="block text-[12px] text-muted-foreground">given up {ago(d.createdAt)}</span>
                    </td>
                    <td>
                      <RetryButton id={d.id} what={`${d.kind} for ${who(d.userEmail, d.userId)}`} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <Card data-enter className="mt-4">
          <CardTitle hint="A service refused these. Worth reading when somebody says a notification never arrived.">Failed deliveries</CardTitle>
          {failed.length === 0 ? (
            <Empty title="No failures" body="Every attempt was accepted by the push service or the email provider." />
          ) : (
            <Table label="Failed deliveries" head={["Creator", "What", "Channel", "Why", "When"]}>
              {failed.map((f) => (
                <tr key={f.id}>
                  <td>
                    <span className="block font-medium">{f.user.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{adminEmail(f.user.email, role)}</span>
                  </td>
                  <td>{f.kind}</td>
                  <td>{f.channel}</td>
                  <td className="max-w-[18rem] truncate text-[12.5px]">{f.detail || reason(f.reason)}</td>
                  <td className="whitespace-nowrap">{ago(f.createdAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card data-enter className="mt-4">
          <CardTitle hint={`The last 40 attempts, newest first, exactly as the engine recorded them. "Accepted" means the channel took the message; it does not mean the creator has seen it.${canSeeEmail(role) ? "" : " Addresses are masked for your role."}`}>Delivery log</CardTitle>
          {log.length === 0 ? (
            <Empty title="Nothing logged yet" body="Every notification writes one row per channel, including the ones that were held back." />
          ) : (
            <Table label="Delivery log" head={["Creator", "What", "Group", "Channel", "Result", "When"]}>
              {log.map((r) => (
                <tr key={r.id}>
                  <td className="truncate text-[12.5px] text-muted-foreground">{adminEmail(r.user.email, role)}</td>
                  <td>{r.kind}</td>
                  <td className="text-[12.5px]">{r.category}</td>
                  <td>{r.channel}</td>
                  <td>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusBadge status={r.status} />
                      {r.reason && <span className="text-[12px] text-muted-foreground">{reason(r.reason)}</span>}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">{ago(r.createdAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </EnterRoot>
    </>
  );
}
