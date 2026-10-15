"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { ADMIN_ROLES, type AdminRole } from "@/lib/admin/perms";
import { Card, CardTitle, Pill, Table, ago } from "./ui";

type A = { id: string; name: string; login: string; role: string; active: boolean; lastLoginAt: string | null };
const ROLES: AdminRole[] = [...ADMIN_ROLES];

export function TeamView({ initial, me, roles }: { initial: A[]; me: string; roles: { label: Record<AdminRole, string>; blurb: Record<AdminRole, string> } }) {
  const [team, setTeam] = useState(initial);
  const [form, setForm] = useState({ name: "", login: "", role: "support" as AdminRole, password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState<A | null>(null);
  const toast = useToast();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await adminApi<{ admin: any }>("/api/admin/team", { method: "POST", json: form });
      setTeam((t) => [...t, { ...r.admin, lastLoginAt: null }]);
      setForm({ name: "", login: "", role: "support", password: "" });
      toast(`${r.admin.name} can sign in now`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function patch(a: A, d: Partial<A>) {
    try {
      const r = await adminApi<{ admin: A }>(`/api/admin/team/${a.id}`, { method: "PATCH", json: d });
      setTeam((t) => t.map((x) => (x.id === a.id ? { ...x, ...r.admin, lastLoginAt: x.lastLoginAt } : x)));
      toast("Saved");
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function remove() {
    if (!del) return;
    try {
      await adminApi(`/api/admin/team/${del.id}`, { method: "DELETE" });
      setTeam((t) => t.filter((x) => x.id !== del.id));
      toast("Removed");
    } catch (e: any) {
      toast(e.message, "error");
    }
    setDel(null);
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        {ROLES.map((r) => (
          <Card key={r} as="div" className="p-4">
            <p className="font-display font-semibold">{roles.label[r]}</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{roles.blurb[r]}</p>
          </Card>
        ))}
      </div>
      <Card>
        <CardTitle>People</CardTitle>
        <Table head={["Name", "Role", "Status", "Last sign-in", ""]}>
          {team.map((a) => (
            <tr key={a.id}>
              <td><span className="block font-medium">{a.name}{a.id === me && <Pill className="ml-2" tone="lime">you</Pill>}</span><span className="font-mono text-[12px] text-muted-foreground">{a.login}</span></td>
              <td>
                <select aria-label={`Role for ${a.name}`} value={a.role} onChange={(e) => patch(a, { role: e.target.value })} className="h-9 rounded-full bg-secondary/60 px-3 text-[13px] font-semibold hairline">
                  {ROLES.map((r) => <option key={r} value={r}>{roles.label[r]}</option>)}
                </select>
              </td>
              <td>
                <button type="button" onClick={() => patch(a, { active: !a.active })} disabled={a.id === me} className="disabled:opacity-60">
                  <Pill tone={a.active ? "ok" : "muted"}>{a.active ? "Active" : "Suspended"}</Pill>
                </button>
              </td>
              <td className="text-muted-foreground">{ago(a.lastLoginAt)}</td>
              <td className="text-right">{a.id !== me && <Button variant="ghost" size="icon-sm" aria-label={`Remove ${a.name}`} onClick={() => setDel(a)}><Trash2 className="h-4 w-4" /></Button>}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card>
        <CardTitle hint="They can change their password after signing in.">Add an admin</CardTitle>
        <form onSubmit={add} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label htmlFor="tm-n">Name</Label><Input id="tm-n" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><Label htmlFor="tm-l">Login</Label><Input id="tm-l" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value.toLowerCase() })} autoComplete="off" required /></div>
          <div>
            <Label htmlFor="tm-r">Role</Label>
            <select id="tm-r" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AdminRole })} className="h-12 w-full rounded-2xl bg-secondary/60 px-3 text-[14px] hairline">
              {ROLES.map((r) => <option key={r} value={r}>{roles.label[r]}</option>)}
            </select>
          </div>
          <div><Label htmlFor="tm-p">Temporary password</Label><Input id="tm-p" type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
          {err && <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive sm:col-span-2 lg:col-span-4">{err}</p>}
          <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" variant="lime" disabled={busy}><Plus className="h-4 w-4" aria-hidden />{busy ? "Adding…" : "Add admin"}</Button></div>
        </form>
      </Card>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Remove ${del?.name}?`} body="They are signed out right away and can't sign in again." confirmLabel="Remove" onConfirm={remove} />
    </div>
  );
}
