import { requireAdmin } from "@/lib/admin/guard";
import { getAdmin } from "@/lib/admin/auth";
import { notifyConfig } from "@/lib/notify-config";
import { deadLetters, failedDeliveries, notifyOverview, pendingQueue, recentDeliveries } from "@/lib/admin/notifications";
import { Card, CardTitle, Empty, PageHead, Pill, Table, ago, fmtDate, type Tone } from "@/components/admin/ui";
import { EnterRoot } from "@/components/admin/motion/EnterRoot";
import { RollingNumber } from "@/components/dashboard/RollingNumber";
import { NotificationsPanel } from "@/components/admin/NotificationsPanel";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, Tone> = { sent: "ok", queued: "info", skipped: "muted", failed: "bad" };
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

export default async function AdminNotificationsPage() {
  await requireAdmin("site");
  const admin = await getAdmin();
  const [cfg, over, failed, dead, queue, log] = await Promise.all([notifyConfig(), notifyOverview(), failedDeliveries(), deadLetters(), pendingQueue(), recentDeliveries(40)]);
  const sent = over.channels.reduce((s, c) => s + c.sent, 0);
  const held = over.channels.reduce((s, c) => s + c.skipped, 0);
  const broke = over.channels.reduce((s, c) => s + c.failed, 0);

  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Notifications"
        body="Everything Outlly says to creators, and why. The numbers are counts of rows that exist: deliveries attempted, skips with the reason recorded, events waiting their turn, events given up on. Creators keep their own switches; nothing here overrides what somebody asked for, it only decides when and how loudly Outlly speaks."
      />

      <EnterRoot>
        <div className="mb-3 grid gap-3 sm:grid-cols-4">
          {[
            { label: "Delivered", v: sent, hint: `Last ${over.days} days, every channel` },
            { label: "Held back", v: held, hint: "Quiet hours, cooldowns, switched off" },
            { label: "Failed", v: broke, hint: "A service refused it" },
            { label: "Waiting", v: over.queue.pending, hint: over.queue.retrying ? `${over.queue.retrying} being retried` : "Nothing stuck" },
          ].map((s) => (
            <Card key={s.label} data-enter className="!p-5">
              <p className="text-[12.5px] font-semibold text-muted-foreground">{s.label}</p>
              <RollingNumber value={s.v.toLocaleString("en-IN")} className="mt-1 block font-display text-[2rem] font-bold leading-none tabular" />
              <p className="mt-2 text-[12.5px] text-muted-foreground">{s.hint}</p>
            </Card>
          ))}
        </div>

        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <Card data-enter>
            <CardTitle hint={`Last ${over.days} days. "Held back" is not a fault: it is somebody's own setting, a quiet hour or a cooldown doing its job.`}>By channel</CardTitle>
            {over.channels.length === 0 ? (
              <Empty title="Nothing sent yet" body="Once notifications go out, every attempt and every skip is counted here." />
            ) : (
              <Table label="Deliveries by channel" head={["Channel", "Delivered", "Held back", "Failed", "Waiting"]}>
                {over.channels.map((c) => (
                  <tr key={c.channel}>
                    <td className="font-medium">{c.channel === "inapp" ? "Bell" : c.channel === "fcm" ? "App (Android)" : c.channel === "push" ? "Web push" : "Email"}</td>
                    <td className="tabular">{c.sent}</td>
                    <td className="tabular">{c.skipped}</td>
                    <td className="tabular">{c.failed}</td>
                    <td className="tabular">{c.queued}</td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              Reachable right now: {over.subs.web.toLocaleString("en-IN")} browser subscription{over.subs.web === 1 ? "" : "s"} across {over.subs.people.toLocaleString("en-IN")} creator{over.subs.people === 1 ? "" : "s"}, {over.subs.fcm.toLocaleString("en-IN")} app device{over.subs.fcm === 1 ? "" : "s"}
              {over.subs.unhealthy > 0 ? `, ${over.subs.unhealthy} subscription${over.subs.unhealthy === 1 ? "" : "s"} failing` : ""}.
            </p>
          </Card>

          <Card data-enter>
            <CardTitle hint="Why a push was not sent, most common first. A long list of one reason is usually a setting worth rethinking rather than a bug.">Why things were held back</CardTitle>
            {over.reasons.length === 0 ? (
              <Empty title="Nothing held back" body="Every notification that was wanted went out." />
            ) : (
              <Table label="Skip reasons" head={["Reason", "Count"]}>
                {over.reasons.map((r) => (
                  <tr key={r.reason}>
                    <td>{reason(r.reason)}</td>
                    <td className="tabular">{r.count}</td>
                  </tr>
                ))}
              </Table>
            )}
            {over.categories.length > 0 && (
              <p className="mt-3 flex flex-wrap gap-1.5">
                {over.categories.map((c) => (
                  <Pill key={c.id} tone="muted">
                    {c.title}: <span className="tabular">{c.count}</span>
                  </Pill>
                ))}
              </p>
            )}
          </Card>
        </div>

        <div data-enter>
          <NotificationsPanel initial={cfg} adminLogin={admin?.login ?? ""} />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Card data-enter>
            <CardTitle hint="Waiting their turn, urgent first. A retry count above zero means a service turned it away and it will be tried again.">Queue</CardTitle>
            {queue.length === 0 ? (
              <Empty title="The queue is empty" body="Events are turned into notifications by the minute sweeper." />
            ) : (
              <Table label="Waiting events" head={["What", "From", "Priority", "Tries", "Due"]}>
                {queue.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{e.kind}</td>
                    <td className="text-[12.5px] text-muted-foreground">{e.source}</td>
                    <td className="tabular">{e.priority}</td>
                    <td className="tabular">{e.attempts}</td>
                    <td className="whitespace-nowrap">{fmtDate(e.nextAt, true)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card data-enter>
            <CardTitle hint="Given up on after four tries. These were never delivered: the payload is kept so the same thing can be sent again once the cause is fixed.">Dead letters</CardTitle>
            {dead.length === 0 ? (
              <Empty title="Nothing was given up on" body="An event that fails four times lands here instead of disappearing." />
            ) : (
              <Table label="Dead letters" head={["What", "From", "Why", "When"]}>
                {dead.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.kind}</td>
                    <td className="text-[12.5px] text-muted-foreground">{d.source}</td>
                    <td className="max-w-[18rem] truncate text-[12.5px]">{d.error}</td>
                    <td className="whitespace-nowrap">{ago(d.createdAt)}</td>
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
                    <span className="block truncate text-[12px] text-muted-foreground">{f.user.email}</span>
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
          <CardTitle hint="The last 40 attempts, newest first, exactly as the engine recorded them.">Delivery log</CardTitle>
          {log.length === 0 ? (
            <Empty title="Nothing logged yet" body="Every notification writes one row per channel, including the ones that were held back." />
          ) : (
            <Table label="Delivery log" head={["Creator", "What", "Group", "Channel", "Result", "When"]}>
              {log.map((r) => (
                <tr key={r.id}>
                  <td className="truncate text-[12.5px] text-muted-foreground">{r.user.email}</td>
                  <td>{r.kind}</td>
                  <td className="text-[12.5px]">{r.category}</td>
                  <td>{r.channel}</td>
                  <td>
                    <Pill tone={STATUS[r.status] ?? "muted"}>{r.status}</Pill>
                    {r.reason && <span className="ml-2 text-[12px] text-muted-foreground">{reason(r.reason)}</span>}
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
