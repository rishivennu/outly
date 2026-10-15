import { requireAdmin } from "@/lib/admin/guard";
import { atRisk, REASON_ACTION, REASON_LABEL } from "@/lib/admin/retention";
import { formatMoney } from "@/lib/billing/money";
import { SAMPLE_DOMAIN } from "@/lib/admin/sample";
import { Card, CardTitle, Empty, PageHead, Pill, Table, ago, fmtDate, type Tone } from "@/components/admin/ui";
import { FilterChips } from "@/components/admin/SearchBox";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { WinbackButton } from "@/components/admin/WinbackButton";

export const metadata = { title: "At risk" };
export const dynamic = "force-dynamic";

const LEVEL_TONE: Record<string, Tone> = { high: "bad", medium: "warn", low: "muted" };
const SHOW = 100;

export default async function RetentionPage({ searchParams }: { searchParams: { f?: string } }) {
  await requireAdmin("retention");
  const f = searchParams.f ?? "";
  const all = await atRisk();
  const flagged = all.filter((r) => r.level !== "low");
  const high = flagged.filter((r) => r.level === "high");
  const paidAtRisk = flagged.filter((r) => r.facts.paid);
  const mrr = paidAtRisk.reduce((s, r) => s + r.priceMinor, 0);
  const currency = paidAtRisk[0]?.currency ?? "INR";
  const rows = (f === "high" ? high : f === "paid" ? paidAtRisk : f === "all" ? all : flagged).slice(0, SHOW);
  const total = f === "high" ? high.length : f === "paid" ? paidAtRisk.length : f === "all" ? all.length : flagged.length;

  return (
    <>
      <PageHead
        eyebrow="Run"
        title="At risk"
        body="Creators likely to leave, scored from what they actually do: posting less, going quiet, failed posts, a signed-out account, a paused or cancelling plan. Paying creators weigh a little more."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="!p-5">
          <p className="text-[12.5px] font-semibold text-muted-foreground">High risk</p>
          <p className="mt-1 font-display text-[2rem] font-bold leading-none tabular">{high.length}</p>
          <p className="mt-2 text-[12.5px] text-muted-foreground">Score 50 or more</p>
        </Card>
        <Card className="!p-5">
          <p className="text-[12.5px] font-semibold text-muted-foreground">Worth a look</p>
          <p className="mt-1 font-display text-[2rem] font-bold leading-none tabular">{flagged.length - high.length}</p>
          <p className="mt-2 text-[12.5px] text-muted-foreground">Score 25 to 49</p>
        </Card>
        <Card className="!p-5">
          <p className="text-[12.5px] font-semibold text-muted-foreground">Revenue at risk</p>
          <p className="mt-1 font-display text-[2rem] font-bold leading-none tabular">{formatMoney(mrr, currency)}</p>
          <p className="mt-2 text-[12.5px] text-muted-foreground">{paidAtRisk.length} paying creator{paidAtRisk.length === 1 ? "" : "s"}, per billing period</p>
        </Card>
      </div>

      <Card>
        <CardTitle hint={`${total.toLocaleString("en-IN")} creator${total === 1 ? "" : "s"}${total > SHOW ? `, top ${SHOW} shown` : ""}. Win-back emails are limited to one a month per person.`}>Who to reach out to</CardTitle>
        <div className="mb-4">
          <FilterChips param="f" current={f} options={[{ value: "", label: "At risk" }, { value: "high", label: "High only" }, { value: "paid", label: "Paying" }, { value: "all", label: "Everyone" }]} />
        </div>
        {rows.length === 0 ? (
          <Empty title="Nobody looks at risk" body="When a creator goes quiet, starts posting less or hits a failure, they show up here with what to do next." />
        ) : (
          <Table label="Creators at risk" head={["Creator", "Risk", "Why", "Last post", "Last active", "Plan", <span key="act" className="sr-only">Action</span>]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="flex items-center gap-2.5">
                    <OrbAvatar avatar={r.avatar} seed={r.email} size={32} />
                    <span className="min-w-0">
                      <span className="block font-medium">{r.name}{r.email.endsWith(SAMPLE_DOMAIN) && <Pill className="ml-2" tone="info">sample</Pill>}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{r.email}</span>
                    </span>
                  </span>
                </td>
                <td>
                  <Pill tone={LEVEL_TONE[r.level]}>
                    <span className="tabular">{r.score}</span> {r.level}
                  </Pill>
                </td>
                <td className="max-w-[260px]">
                  {r.reasons.length ? (
                    <>
                      <span className="block text-[13px]">{r.reasons.map((x) => REASON_LABEL[x]).join(", ")}</span>
                      <span className="block text-[12px] text-muted-foreground">{REASON_ACTION[r.reasons[0]]}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Doing fine</span>
                  )}
                </td>
                <td className="whitespace-nowrap">{r.lastPost ? ago(r.lastPost) : <span className="text-muted-foreground">Never</span>}</td>
                <td className="whitespace-nowrap">{ago(r.lastActive)}</td>
                <td>{r.plan ? <span className="flex flex-wrap items-center gap-1.5"><Pill tone="lime">{r.plan}</Pill>{r.facts.cancelling && <Pill tone="warn">cancelling</Pill>}{r.facts.paused && <Pill tone="info">paused</Pill>}</span> : <span className="text-muted-foreground">Free</span>}</td>
                <td className="text-right">
                  <WinbackButton userId={r.id} name={r.name} email={r.email} lastSent={r.canWinback ? null : fmtDate(r.winbackAt)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
