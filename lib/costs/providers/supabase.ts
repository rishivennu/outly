import "server-only";
import { recordUsage } from "../ledger";
import { eachDay, getJson, type Adapter } from "./types";

/**
 * Supabase. The Management API names organisations with their plan and lists projects; metered usage and invoices
 * are not public. So this adapter books each paid organisation's daily share of its plan at list price (estimate)
 * and records projects as facts; database size, egress and storage stay on the estimate path and invoices come in
 * by hand or CSV.
 */
type Org = { id: string; slug: string; name: string; plan?: string };
type Project = { id: string; ref: string; name: string; organization_id: string; status: string; region: string };

/** Supabase organisation plans, USD per month (supabase.com/pricing, 2026). */
export const SUPABASE_PLAN_USD: Record<string, number> = { free: 0, pro: 25, team: 599 };
export const planSku = (plan: string) => `supabase:plan-${plan.toLowerCase()}-month`;

export const supabase: Adapter = {
  provider: "supabase",
  label: "Supabase",
  tokenHelp: "Account > Access Tokens > Generate a scoped token with read-only access to the organisation and its projects.",
  scopeLabel: "Organisation slug",
  scopeHelp: "The slug in the dashboard URL. Leave empty to use every organisation the token can see.",
  capability: "Names the organisation and its plan, lists projects, and books the paid plan's daily share at list price (estimate). Usage (database size, egress, storage) and invoices are not exposed by the Management API: paste or import invoices.",
  async test(token, scope) {
    const orgs = await getJson<Org[]>("https://api.supabase.com/v1/organizations", token);
    const chosen = scope ? orgs.filter((o) => o.slug === scope) : orgs;
    if (scope && !chosen.length) throw new Error(`No organisation with slug "${scope}" is visible to this token.`);
    const detailed = await Promise.all(chosen.map((o) => getJson<Org>(`https://api.supabase.com/v1/organizations/${encodeURIComponent(o.slug)}`, token).catch(() => o)));
    const projects = await getJson<Project[]>("https://api.supabase.com/v1/projects", token);
    const ids = new Set(detailed.map((o) => o.id));
    return { label: detailed.map((o) => o.name).join(", ") || "Supabase", facts: { orgs: detailed.map((o) => ({ slug: o.slug, name: o.name, plan: (o.plan ?? "").toLowerCase() })), projects: projects.filter((p) => ids.has(p.organization_id)).map((p) => ({ ref: p.ref, name: p.name, status: p.status, region: p.region })) } };
  },
  async sync(token, scope, range) {
    const t = await this.test(token, scope);
    const orgs = t.facts.orgs as { slug: string; name: string; plan: string }[];
    const notes: string[] = [];
    let booked = 0;
    for (const o of orgs) {
      if (!o.plan) { notes.push(`${o.name}: the API did not say which plan; nothing booked.`); continue; }
      if (SUPABASE_PLAN_USD[o.plan] === 0) continue;
      if (SUPABASE_PLAN_USD[o.plan] == null) { notes.push(`${o.name}: plan "${o.plan}" has no list price on file; add ${planSku(o.plan)} under Unit prices.`); continue; }
      for (const day of eachDay(range.from, range.to)) {
        const at = new Date(`${day}T12:00:00Z`);
        const dim = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
        const ev = await recordUsage({ provider: "supabase", sku: planSku(o.plan), units: 1 / dim, unit: "month", category: "database", feature: "platform", source: "estimate", ref: `supabase:plan:${o.slug}:${day}`, note: `${o.name} (${o.plan})`, at, meta: { org: o.slug, plan: o.plan } });
        if (ev) booked++;
      }
    }
    notes.push("Usage and invoices are not exposed by Supabase's Management API; only the plan was booked.");
    return { booked, facts: t.facts, notes };
  },
};
