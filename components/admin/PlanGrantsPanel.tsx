"use client";
import { useEffect, useState } from "react";
import { BadgeCheck, CalendarPlus, History, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Pill, Table, ago, fmtDate, type Tone } from "./ui";

type PlanOpt = { slug: string; name: string };
type Grant = {
  id: string; email: string; plan: string; planName: string; source: string; status: string; state: string;
  startsAt: string; endsAt: string; durationDays: number | null; note: string; grantedBy?: string | null;
  revokedBy?: string | null; revokeReason?: string | null; createdAt: string;
};
type Access = {
  email: string;
  user: { id: string; name: string; createdAt: string; verified: boolean } | null;
  current: { plan: string; planName: string; source: string; endsAt: string | null } | null;
  grants: Grant[];
  subscriptions: { id: string; plan: string; planName: string; status: string; provider: string; paid: boolean; endsAt: string; pausedUntil: string | null; createdAt: string }[];
  history: { id: string; actor: string; actorRole: string | null; action: string; note: string | null; createdAt: string }[];
};

const STATE_TONE: Record<string, Tone> = { active: "ok", scheduled: "info", pending: "warn", expired: "muted", revoked: "bad" };
const SOURCE_LABEL: Record<string, string> = { paid: "Paid plan", admin: "Admin grant", referral: "Referral reward", gift: "Gift (beta code)", free: "Free" };
const ACTION_LABEL: Record<string, string> = {
  "grant.create": "Granted", "grant.extend": "Extended", "grant.upgrade": "Upgraded", "grant.downgrade": "Downgraded",
  "grant.revoke": "Revoked", "grant.activate": "Activated on verify", "referral.reward": "Referral reward", "referral.revoke": "Referral disqualified", "referral.config": "Refer & Earn settings",
};
const PRESETS = [30, 90, 180, 365];
const today = () => new Date().toISOString().slice(0, 10);

/** Admin: find an account by email, see every source of access, and grant, extend, change or revoke a plan. */
export function PlanGrantsPanel({ plans, initialList, initialEmail }: { plans: PlanOpt[]; initialList: Grant[]; initialEmail: string | null }) {
  const toast = useToast();
  const [q, setQ] = useState(initialEmail ?? "");
  const [acc, setAcc] = useState<Access | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [list, setList] = useState(initialList);
  const [filter, setFilter] = useState("");
  // new grant form
  const [plan, setPlan] = useState(plans[0]?.slug ?? "creator");
  const [mode, setMode] = useState<"days" | "date">("days");
  const [days, setDays] = useState("30");
  const [endsAt, setEndsAt] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [note, setNote] = useState("");
  // per-grant edits
  const [edit, setEdit] = useState<{ id: string; kind: "extend" | "change" } | null>(null);
  const [extraDays, setExtraDays] = useState("30");
  const [newEnd, setNewEnd] = useState("");
  const [newPlan, setNewPlan] = useState("");
  const [editNote, setEditNote] = useState("");
  const [revoke, setRevoke] = useState<Grant | null>(null);
  const [reason, setReason] = useState("");

  async function lookup(email = q) {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setBusy("find");
    try {
      setAcc(await adminApi<Access>(`/api/admin/grants?email=${encodeURIComponent(e)}`));
      window.history.replaceState(null, "", `/admin/plans?email=${encodeURIComponent(e)}`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    if (initialEmail) void lookup(initialEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadList(state = filter) {
    try {
      setList((await adminApi<{ grants: Grant[] }>(`/api/admin/grants${state ? `?state=${state}` : ""}`)).grants);
    } catch {
      /* the list is a convenience; the account view already updated */
    }
  }

  async function act(key: string, url: string, init: { method: "POST" | "PATCH"; json: unknown }, ok: string) {
    setBusy(key);
    try {
      const r = await adminApi<{ access: Access }>(url, init);
      setAcc(r.access);
      toast(ok);
      setEdit(null);
      setEditNote("");
      void reloadList();
      return true;
    } catch (err) {
      toast((err as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const live = acc?.grants.find((g) => g.source === "admin" && (g.state === "active" || g.state === "pending" || g.state === "scheduled"));
  const n = Math.floor(Number(days) || 0);
  const createGrant = () =>
    act("create", "/api/admin/grants", {
      method: "POST",
      json: { email: acc?.email ?? q, plan, note, ...(mode === "days" ? { days: n } : { endsAt }), ...(startsAt ? { startsAt } : {}) },
    }, acc?.user?.verified ? "Plan granted. It's live now." : "Saved as pending. It switches on when they verify this email.").then((ok) => ok && setNote(""));

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardTitle hint="Exact email. Works for people who haven't signed up yet: the grant waits for that address to be verified.">Find an account</CardTitle>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
          <div className="min-w-[16rem] flex-1">
            <Label htmlFor="pg-q">Email</Label>
            <Input id="pg-q" type="email" inputMode="email" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="name@example.com" />
          </div>
          <Button type="submit" variant="primary" disabled={!q.trim() || busy === "find"}>
            <Search className="h-4 w-4" aria-hidden /> {busy === "find" ? "Looking…" : "Look up"}
          </Button>
        </form>
      </Card>

      {acc && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardTitle hint={acc.user ? `Joined ${fmtDate(acc.user.createdAt)}` : "No account with this email yet"} action={acc.user ? <Pill tone={acc.user.verified ? "ok" : "warn"}>{acc.user.verified ? "Email verified" : "Not verified"}</Pill> : <Pill tone="muted">Not registered</Pill>}>
              <span className="inline-flex items-center gap-2"><UserRound className="h-4 w-4" aria-hidden /> {acc.user?.name ?? acc.email}</span>
            </CardTitle>
            <p className="text-[13px] text-muted-foreground">{acc.email}</p>
            <div className="mt-4 rounded-[20px] bg-secondary/40 p-4 hairline">
              <p className="text-[12px] font-semibold text-muted-foreground">Access right now</p>
              <p className="mt-1 font-display text-[1.4rem] font-bold">{acc.current?.planName ?? (acc.user ? "Free" : "None (not registered)")}</p>
              {acc.current && (
                <p className="text-[13px] text-muted-foreground">
                  {SOURCE_LABEL[acc.current.source] ?? acc.current.source}
                  {acc.current.endsAt ? `, until ${fmtDate(acc.current.endsAt)}` : ""}
                </p>
              )}
              <p className="mt-2 text-[12px] text-muted-foreground">The highest plan from any source wins. Ending one source never cancels another.</p>
            </div>
            {acc.subscriptions.length > 0 && (
              <div className="mt-4">
                <p className="text-[12px] font-semibold text-muted-foreground">Subscriptions</p>
                <ul className="mt-1 space-y-1 text-[13px]">
                  {acc.subscriptions.slice(0, 6).map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2">
                      <Pill tone={s.status === "active" ? "ok" : "muted"}>{s.status}</Pill>
                      <span>{s.planName}</span>
                      <span className="text-muted-foreground">{s.paid ? "paid" : s.provider}, to {fmtDate(s.endsAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle hint={live ? "This person already has a live grant. Extend or change it below." : acc.user?.verified ? "Starts now unless you pick a later start date." : "They'll get it the moment this exact email is verified."}>
              <span className="inline-flex items-center gap-2"><BadgeCheck className="h-4 w-4" aria-hidden /> Grant a plan</span>
            </CardTitle>
            <fieldset disabled={!!live || !!busy} className="grid gap-3 disabled:opacity-60">
              <div>
                <Label htmlFor="pg-plan">Plan</Label>
                <select id="pg-plan" value={plan} onChange={(e) => setPlan(e.target.value)} className="h-11 w-full rounded-2xl bg-secondary/50 px-3 text-[14px] hairline">
                  {plans.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              </div>
              <div role="radiogroup" aria-label="How long" className="flex gap-2">
                {(["days", "date"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn("h-11 flex-1 rounded-2xl text-[13.5px] font-medium hairline", mode === m ? "bg-foreground text-background" : "bg-secondary/40")}>
                    {m === "days" ? "For a length" : "Until a date"}
                  </button>
                ))}
              </div>
              {mode === "days" ? (
                <div>
                  <Label htmlFor="pg-days">Days</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input id="pg-days" type="number" inputMode="numeric" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
                    {PRESETS.map((d) => (
                      <button key={d} type="button" onClick={() => setDays(String(d))} className={cn("h-11 rounded-2xl px-3 text-[13px] hairline", n === d ? "bg-lime/20 text-lime-ink" : "bg-secondary/40")}>{d === 365 ? "1 year" : `${d / 30} mo`}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <Label htmlFor="pg-end">Ends on</Label>
                  <Input id="pg-end" type="date" min={today()} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="pg-start">Start (optional)</Label>
                  <Input id="pg-start" type="date" min={today()} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="pg-note">Note</Label>
                  <Input id="pg-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why, e.g. partner creator" />
                </div>
              </div>
              <Button type="button" variant="primary" onClick={createGrant} disabled={mode === "days" ? n < 1 : !endsAt}>
                {busy === "create" ? "Saving…" : acc.user?.verified ? "Grant now" : "Save as pending"}
              </Button>
            </fieldset>
          </Card>

          <Card className="lg:col-span-2">
            <CardTitle hint="Admin grants and referral rewards for this person, newest first.">Grants</CardTitle>
            {acc.grants.length === 0 ? (
              <Empty title="No grants yet" body="Anything you grant shows here with its dates and who made it." />
            ) : (
              <ul className="divide-y divide-border/60">
                {acc.grants.map((g) => {
                  const open = g.state === "active" || g.state === "pending" || g.state === "scheduled";
                  return (
                    <li key={g.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={STATE_TONE[g.state] ?? "muted"}>{g.state}</Pill>
                        <span className="font-medium">{g.planName}</span>
                        <span className="text-[13px] text-muted-foreground">
                          {g.source === "referral" ? "Referral reward" : `by ${g.grantedBy ?? "admin"}`}
                          {g.state === "pending" && g.durationDays ? `, ${g.durationDays} days from verification` : `, ${fmtDate(g.startsAt)} to ${fmtDate(g.endsAt)}`}
                        </span>
                        {open && g.source === "admin" && (
                          <span className="ml-auto flex flex-wrap gap-1">
                            <Button type="button" size="sm" variant="ghost" onClick={() => { setEdit({ id: g.id, kind: "extend" }); setNewEnd(""); }}>Extend</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => { setEdit({ id: g.id, kind: "change" }); setNewPlan(plans.find((p) => p.slug !== g.plan)?.slug ?? g.plan); }}>Change plan</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => { setRevoke(g); setReason(""); }}>Revoke</Button>
                          </span>
                        )}
                      </div>
                      {g.note && <p className="mt-1 text-[12.5px] text-muted-foreground">Note: {g.note}</p>}
                      {g.revokeReason && <p className="mt-1 text-[12.5px] text-muted-foreground">Revoked by {g.revokedBy}: {g.revokeReason}</p>}
                      {edit?.id === g.id && (
                        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-[20px] bg-secondary/40 p-3 hairline">
                          {edit.kind === "extend" ? (
                            <>
                              <div>
                                <Label htmlFor={`x-${g.id}`}>Add days</Label>
                                <Input id={`x-${g.id}`} type="number" min={1} max={3660} value={extraDays} onChange={(e) => { setExtraDays(e.target.value); setNewEnd(""); }} className="w-28" />
                              </div>
                              <p className="pb-3 text-[13px] text-muted-foreground">or</p>
                              <div>
                                <Label htmlFor={`e-${g.id}`}>New end date</Label>
                                <Input id={`e-${g.id}`} type="date" min={today()} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
                              </div>
                            </>
                          ) : (
                            <div>
                              <Label htmlFor={`p-${g.id}`}>New plan</Label>
                              <select id={`p-${g.id}`} value={newPlan} onChange={(e) => setNewPlan(e.target.value)} className="h-11 rounded-2xl bg-background px-3 text-[14px] hairline">
                                {plans.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                              </select>
                            </div>
                          )}
                          <div className="min-w-[12rem] flex-1">
                            <Label htmlFor={`n-${g.id}`}>Note</Label>
                            <Input id={`n-${g.id}`} value={editNote} maxLength={500} onChange={(e) => setEditNote(e.target.value)} />
                          </div>
                          <Button
                            type="button"
                            variant="primary"
                            disabled={!!busy}
                            onClick={() =>
                              edit.kind === "extend"
                                ? act("edit", `/api/admin/grants/${g.id}`, { method: "PATCH", json: { action: "extend", note: editNote, ...(newEnd ? { endsAt: newEnd } : { days: Math.floor(Number(extraDays) || 0) }) } }, "Grant extended.")
                                : act("edit", `/api/admin/grants/${g.id}`, { method: "PATCH", json: { action: "change", plan: newPlan, note: editNote } }, "Plan changed. Dates stay the same.")
                            }
                          >
                            {busy === "edit" ? "Saving…" : "Save"}
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="lg:col-span-2">
            <CardTitle hint="Every grant change for this email, with who did it.">
              <span className="inline-flex items-center gap-2"><History className="h-4 w-4" aria-hidden /> History</span>
            </CardTitle>
            {acc.history.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
            ) : (
              <ol className="space-y-2 text-[13px]">
                {acc.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-2">
                    <span className="w-28 shrink-0 text-muted-foreground">{fmtDate(h.createdAt, true)}</span>
                    <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
                    <span className="text-muted-foreground">by {h.actor}{h.actorRole ? ` (${h.actorRole})` : ""}</span>
                    {h.note && <span className="text-muted-foreground">: {h.note}</span>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      )}

      <Card>
        <CardTitle
          hint="Admin grants across everyone, newest first."
          action={
            <select aria-label="Filter grants" value={filter} onChange={(e) => { setFilter(e.target.value); void reloadList(e.target.value); }} className="h-11 rounded-2xl bg-secondary/50 px-3 text-[13.5px] hairline">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="ended">Ended</option>
            </select>
          }
        >
          <span className="inline-flex items-center gap-2"><CalendarPlus className="h-4 w-4" aria-hidden /> Recent grants</span>
        </CardTitle>
        {list.length === 0 ? (
          <Empty title="No grants" body="Look someone up above to give them a plan." />
        ) : (
          <Table label="Plan grants" head={["Email", "Plan", "Status", "Ends", "By", "Made"]}>
            {list.map((g) => (
              <tr key={g.id}>
                <td className="max-w-[260px] truncate">
                  <button type="button" className="min-h-[44px] text-left underline-offset-2 hover:underline" onClick={() => { setQ(g.email); void lookup(g.email); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{g.email}</button>
                </td>
                <td>{g.planName}</td>
                <td><Pill tone={STATE_TONE[g.state] ?? "muted"}>{g.state}</Pill></td>
                <td className="whitespace-nowrap text-muted-foreground">{g.state === "pending" && g.durationDays ? `${g.durationDays} days after verify` : fmtDate(g.endsAt)}</td>
                <td className="text-muted-foreground">{g.grantedBy ?? "admin"}</td>
                <td className="whitespace-nowrap text-muted-foreground">{ago(g.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        title={`Revoke ${revoke?.planName ?? ""} for ${revoke?.email ?? ""}?`}
        body="Access from this grant ends now. A paid plan or referral reward they also have keeps running."
        confirmLabel="Revoke grant"
        busy={busy === "revoke"}
        extra={
          <div className="mt-3">
            <Label htmlFor="pg-reason">Reason (kept in the audit log)</Label>
            <Input id="pg-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </div>
        }
        onConfirm={() => {
          if (!revoke) return;
          if (reason.trim().length < 3) return toast("Say why, for the audit trail.", "error");
          void act("revoke", `/api/admin/grants/${revoke.id}`, { method: "PATCH", json: { action: "revoke", reason } }, "Grant revoked.").then((ok) => ok && setRevoke(null));
        }}
      />
    </div>
  );
}
