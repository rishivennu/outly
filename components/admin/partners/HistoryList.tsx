import { Card, CardTitle, fmtDate } from "@/components/admin/ui";
import { PARTNER_STATUS_LABEL, type PartnerStatus } from "@/lib/partners/types";
import { eventLabel } from "./bits";

export type PartnerEventRow = { id: string; actor: string; action: string; from: string | null; to: string | null; meta: Record<string, unknown>; createdAt: string };

const status = (s: string | null) => (s ? PARTNER_STATUS_LABEL[s as PartnerStatus] ?? s : "");
const who = (actor: string) => (actor === "creator" ? "The creator" : actor === "system" ? "Outlly (automatic)" : actor);

/** Every PartnerEvent, newest first: who, when, what. */
export default function HistoryList({ events }: { events: PartnerEventRow[] }) {
  return (
    <Card>
      <CardTitle hint="Newest first. Times in IST.">History</CardTitle>
      {events.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing has happened yet.</p>
      ) : (
        <ol className="grid gap-3">
          {events.map((e) => {
            const message = typeof e.meta.message === "string" ? e.meta.message : "";
            return (
              <li key={e.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                <span aria-hidden="true" className="mt-[7px] h-2 w-2 rounded-full bg-muted-foreground/60" />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium leading-snug">
                    {e.action === "status" && e.to ? (e.from ? `${status(e.from)} to ${status(e.to)}` : status(e.to)) : eventLabel(e.action)}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {who(e.actor)} · <time dateTime={e.createdAt}>{fmtDate(e.createdAt, true)}</time>
                  </p>
                  {message && <p className="mt-1 whitespace-pre-wrap rounded-xl bg-secondary/40 px-3 py-2 text-[12.5px] [overflow-wrap:anywhere]"><span className="font-semibold">Sent to the creator: </span>{message}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
