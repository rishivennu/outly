"use client";
import { useEffect, useState } from "react";
import { Check, Copy, LogOut, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type Role = "editor" | "manager";
type Member = { id: string; email: string; name: string | null; role: Role; status: "invited" | "active"; expired: boolean; accountIds: string[] | null };
type Acct = { id: string; platform: string; username: string };
type Team = { seats: { used: number; total: number; plan: string }; members: Member[]; accounts: Acct[] };
const PNAME: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", x: "X", facebook: "Facebook", tiktok: "TikTok", threads: "Threads", linkedin: "LinkedIn" };

/**
 * Which accounts one member may work on (1037). "All accounts" is the default and also covers accounts
 * connected later; ticking specific ones limits them to exactly those, everywhere in the studio.
 */
function AccountAccess({ m, accounts, busy, onSave }: { m: Member; accounts: Acct[]; busy: boolean; onSave: (ids: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const all = m.accountIds === null;
  const picked = new Set(m.accountIds ?? []);
  const label = all ? "All accounts" : `${m.accountIds!.filter((id) => accounts.some((a) => a.id === id)).length} of ${accounts.length} accounts`;
  const flip = (id: string) => {
    const next = all ? accounts.map((a) => a.id).filter((x) => x !== id) : picked.has(id) ? [...picked].filter((x) => x !== id) : [...picked, id];
    onSave(next.length === accounts.length ? null : next);
  };
  return (
    <div className="w-full sm:w-auto">
      <button type="button" aria-expanded={open} aria-controls={`acc-${m.id}`} onClick={() => setOpen((o) => !o)} className="h-11 rounded-2xl px-3 text-sm hairline hover:bg-secondary/60 focus-visible:outline-2">
        {label}
      </button>
      {open && (
        <fieldset id={`acc-${m.id}`} className="mt-2 rounded-2xl bg-secondary/40 p-3" disabled={busy}>
          <legend className="sr-only">Accounts {m.name ?? m.email} can work on</legend>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--lime))]" checked={all} onChange={() => onSave(all ? [] : null)} /> All accounts, including ones added later
          </label>
          <ul className="mt-1 grid gap-1 sm:grid-cols-2">
            {accounts.map((a) => (
              <li key={a.id}>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--lime))]" checked={all || picked.has(a.id)} onChange={() => flip(a.id)} />
                  <span className="truncate">{a.username} <span className="text-muted-foreground">{PNAME[a.platform] ?? a.platform}</span></span>
                </label>
              </li>
            ))}
          </ul>
          {!all && picked.size === 0 && <p className="mt-2 text-xs text-warning">No accounts ticked: they can open the studio but can&apos;t see or post to any account.</p>}
        </fieldset>
      )}
    </div>
  );
}
type Workspace = { ownerId: string; ownerName: string; ownerEmail: string; role: Role };
type Data = { current: { ownerId: string; ownerName: string; role: string } | null; team: Team | null; workspaces: Workspace[] };

const ROLE_HELP: Record<Role, string> = {
  editor: "Uploads and writes drafts. Can't publish.",
  manager: "Everything an editor does, plus publishing.",
};
const selectCls = "h-11 rounded-2xl bg-secondary/60 px-3 text-sm text-foreground hairline focus-visible:outline-2";

export function TeamCard() {
  const toast = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => api<Data>("/api/team").then(setD, () => setFailed(true));
  useEffect(() => {
    void load();
  }, []);
  const setTeam = (team: Team) => setD((x) => (x ? { ...x, team } : x));
  const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Something got in the way.");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy("invite");
    try {
      const r = await api<Team & { inviteUrl: string }>("/api/team/members", { method: "POST", json: { email: email.trim(), role } });
      setTeam(r);
      setLink(r.inviteUrl);
      toast(`Invite sent to ${email.trim()}.`, "ok");
      setEmail("");
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(null);
    }
  };
  const changeRole = async (m: Member, r: Role) => {
    setBusy(m.id);
    try {
      setTeam(await api<Team>(`/api/team/members/${m.id}`, { method: "PATCH", json: { role: r } }));
      toast(`${m.name ?? m.email} is now ${r === "manager" ? "a manager" : "an editor"}.`, "ok");
    } catch (err) {
      toast(msg(err), "error");
    } finally {
      setBusy(null);
    }
  };
  const setAccess = async (m: Member, accountIds: string[] | null) => {
    setBusy(m.id);
    try {
      setTeam(await api<Team>(`/api/team/members/${m.id}`, { method: "PATCH", json: { accountIds } }));
      toast(accountIds === null ? `${m.name ?? m.email} can work on every account.` : `${m.name ?? m.email} can work on ${accountIds.length} account${accountIds.length === 1 ? "" : "s"}.`, "ok");
    } catch (err) {
      toast(msg(err), "error");
    } finally {
      setBusy(null);
    }
  };
  const remove = async (m: Member) => {
    if (!window.confirm(m.status === "invited" ? `Cancel the invite for ${m.email}?` : `Remove ${m.name ?? m.email} from your team? They lose access straight away.`)) return;
    setBusy(m.id);
    try {
      setTeam(await api<Team>(`/api/team/members/${m.id}`, { method: "DELETE" }));
    } catch (err) {
      toast(msg(err), "error");
    } finally {
      setBusy(null);
    }
  };
  const open = async (ownerId: string | null) => {
    setBusy(ownerId ?? "mine");
    try {
      await api("/api/team/switch", { method: "POST", json: { ownerId } });
      window.location.href = "/home";
    } catch (err) {
      toast(msg(err), "error");
      setBusy(null);
    }
  };
  const leave = async (w: Workspace) => {
    if (!window.confirm(`Leave ${w.ownerName}'s studio? You'll need a new invite to come back.`)) return;
    setBusy(w.ownerId);
    try {
      await api("/api/team/leave", { method: "POST", json: { ownerId: w.ownerId } });
      if (d?.current?.ownerId === w.ownerId) window.location.href = "/home";
      else await load();
    } catch (err) {
      toast(msg(err), "error");
    } finally {
      setBusy(null);
    }
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Couldn't copy. Select the link and copy it yourself.", "error");
    }
  };

  const team = d?.team;
  const full = !!team && team.seats.used >= team.seats.total;
  return (
    <section id="team" className="glass scroll-mt-24 rounded-[32px] p-6 sm:p-8" aria-labelledby="team-h" aria-busy={!d && !failed}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary" aria-hidden="true">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h2 id="team-h" className="text-2xl font-semibold tracking-tight">Team</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">Bring in an editor or a manager. They work in your studio with their own login; billing and connected accounts stay yours.</p>
          </div>
        </div>
        {team && (
          <p className="rounded-full bg-secondary px-3 py-1 text-sm tabular">
            {team.seats.used} of {team.seats.total} seat{team.seats.total === 1 ? "" : "s"} used
          </p>
        )}
      </div>

      {failed && <p role="alert" className="mt-5 text-sm text-destructive">Your team didn't load. Refresh to try again.</p>}

      {d?.current && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-secondary/60 p-4 text-sm">
          <p>
            You're working in <b>{d.current.ownerName}</b>'s studio. Their team and your own profile are managed from your own studio.
          </p>
          <Button variant="outline" onClick={() => open(null)} disabled={busy === "mine"}>
            {busy === "mine" ? "Switching…" : "Back to my studio"}
          </Button>
        </div>
      )}

      {team && (
        <>
          <form onSubmit={send} className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end" aria-label="Invite someone">
            <div>
              <Label htmlFor="inv-email">Their email</Label>
              <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" required maxLength={200} disabled={full} />
            </div>
            <div>
              <Label htmlFor="inv-role">Role</Label>
              <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={cn(selectCls, "h-12 w-full sm:w-auto")} disabled={full} aria-describedby="inv-role-help">
                <option value="editor">Editor</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <Button type="submit" variant="primary" className="h-12" disabled={full || busy === "invite" || !email.trim()}>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> {busy === "invite" ? "Sending…" : "Send invite"}
            </Button>
          </form>
          <p id="inv-role-help" className="mt-2 text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
          {full && (
            <p className="mt-3 text-sm">
              {team.seats.total === 0 ? `${team.seats.plan} doesn't include team seats.` : `All ${team.seats.total} seats on ${team.seats.plan} are taken.`}{" "}
              <a href="/billing" className="font-medium underline underline-offset-4">Upgrade in Billing</a>
            </p>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
          {link && (
            <div className="mt-4 rounded-2xl bg-secondary/60 p-4">
              <p className="text-sm">If the email doesn't arrive, send them this link yourself. It works for 14 days.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <label htmlFor="inv-link" className="sr-only">Invite link</label>
                <input id="inv-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-2xl bg-background/70 px-3 text-sm hairline focus-visible:outline-2" />
                <Button variant="outline" onClick={copy} aria-live="polite">
                  {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}

          {team.members.length > 0 && (
            <ul className="mt-6 divide-y divide-border/60" aria-label="Team members">
              {team.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.name ?? m.email}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.name ? `${m.email} · ` : ""}
                      {m.status === "active" ? "Joined" : m.expired ? "Invite expired, send it again" : "Invite pending"}
                    </p>
                  </div>
                  <label htmlFor={`role-${m.id}`} className="sr-only">Role for {m.name ?? m.email}</label>
                  <select id={`role-${m.id}`} value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)} disabled={busy === m.id} className={selectCls}>
                    <option value="editor">Editor</option>
                    <option value="manager">Manager</option>
                  </select>
                  {team.accounts.length > 1 && <AccountAccess m={m} accounts={team.accounts} busy={busy === m.id} onSave={(ids) => setAccess(m, ids)} />}
                  <button type="button" onClick={() => remove(m)} disabled={busy === m.id} aria-label={m.status === "invited" ? `Cancel invite for ${m.email}` : `Remove ${m.name ?? m.email}`} className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 disabled:opacity-50">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {d && d.workspaces.length > 0 && (
        <div className="mt-6">
          <h3 className="text-base font-semibold">Studios you've joined</h3>
          <ul className="mt-2 divide-y divide-border/60">
            {d.workspaces.map((w) => {
              const here = d.current?.ownerId === w.ownerId;
              return (
                <li key={w.ownerId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{w.ownerName}</p>
                    <p className="truncate text-xs text-muted-foreground">{w.role === "manager" ? "Manager" : "Editor"}{here ? " · you're here now" : ""}</p>
                  </div>
                  {!here && (
                    <Button variant="outline" onClick={() => open(w.ownerId)} disabled={busy === w.ownerId}>
                      Open
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => leave(w)} disabled={busy === w.ownerId} aria-label={`Leave ${w.ownerName}'s studio`}>
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Leave
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
