import "server-only";
import { recordUsage } from "../ledger";
import { eachDay, getJson, type Adapter } from "./types";

/**
 * Render. The public API lists services with their instance plan and serves bandwidth metrics per service, so this
 * adapter books two things a day: each paid service's share of its monthly plan (an estimate at list price, until
 * the invoice arrives and supersedes it) and the bandwidth the metrics endpoint reports. It cannot see invoices or
 * the included-bandwidth allowance, so bandwidth is booked gross at the price on file.
 */
type Owner = { owner: { id: string; name: string; email?: string; type: string } };
type Service = { service: { id: string; name: string; type: string; suspended: string; serviceDetails?: { plan?: string; pullRequestPreviewsEnabled?: string } } };
type Metric = { labels: { field: string; value: string }[]; unit: string; values: { timestamp: string; value: number }[] };

/** Render instance plans, USD per month (render.com/pricing, 2026). Free and static sites cost nothing. */
export const RENDER_PLAN_USD: Record<string, number> = { free: 0, starter: 7, standard: 25, pro: 85, pro_plus: 175, pro_max: 225, pro_ultra: 450 };
export const planSku = (plan: string) => `render:plan-${plan.toLowerCase().replace(/[^a-z0-9]+/g, "_")}-month`;

export const render: Adapter = {
  provider: "render",
  label: "Render",
  tokenHelp: "Account Settings > API Keys > Create. Render API keys are read/write by design: keep this one for Outlly only and rotate it if in doubt; Outlly never calls a writing endpoint.",
  scopeLabel: "",
  scopeHelp: "",
  capability: "Lists services and their plans, books each paid service's daily share of its plan at list price (estimate) and the bandwidth Render reports per day. Invoices are not exposed: paste or import them and they supersede the estimates.",
  async test(token) {
    const owners = await getJson<Owner[]>("https://api.render.com/v1/owners?limit=20", token);
    const services = await getJson<Service[]>("https://api.render.com/v1/services?limit=100", token);
    const o = owners[0]?.owner;
    return { label: o ? o.name : "Render account", facts: { owners: owners.map((x) => x.owner.name), services: services.map((s) => ({ id: s.service.id, name: s.service.name, type: s.service.type, plan: s.service.serviceDetails?.plan ?? "", suspended: s.service.suspended === "suspended" })) } };
  },
  async sync(token, scope, range) {
    const t = await this.test(token, scope);
    const services = t.facts.services as { id: string; name: string; type: string; plan: string; suspended: boolean }[];
    const notes: string[] = [];
    let booked = 0;
    const days = eachDay(range.from, range.to);
    for (const s of services) {
      const plan = (s.plan || "").toLowerCase();
      if (!plan || s.suspended || s.type === "static_site" || RENDER_PLAN_USD[plan] === 0) continue;
      if (RENDER_PLAN_USD[plan] == null) { notes.push(`${s.name}: plan "${s.plan}" has no list price on file; add ${planSku(plan)} under Unit prices.`); continue; }
      for (const day of days) {
        const at = new Date(`${day}T12:00:00Z`);
        const dim = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
        const ev = await recordUsage({ provider: "render", sku: planSku(plan), units: 1 / dim, unit: "month", category: "hosting", feature: "platform", source: "estimate", ref: `render:plan:${s.id}:${day}`, note: `${s.name} (${plan})`, at, meta: { serviceId: s.id, plan } });
        if (ev) booked++;
      }
    }
    // Bandwidth: one query per service for the whole range, bucketed by day in UTC.
    const live = services.filter((s) => !s.suspended);
    const perDay = new Map<string, number>();
    for (const s of live) {
      const start = Math.floor(new Date(`${range.from}T00:00:00Z`).getTime() / 1000), end = Math.floor(Math.min(range.now.getTime(), new Date(`${range.to}T23:59:59Z`).getTime()) / 1000);
      const m = await getJson<Metric[]>(`https://api.render.com/v1/metrics/bandwidth?resource=${encodeURIComponent(s.id)}&startTime=${start}&endTime=${end}`, token).catch((e) => { notes.push(`${s.name}: bandwidth not read (${(e as Error).message}).`); return [] as Metric[]; });
      for (const series of m) for (const v of series.values) {
        const day = v.timestamp.slice(0, 10);
        const bytes = series.unit === "GB" ? v.value * 1e9 : series.unit === "MB" ? v.value * 1e6 : series.unit === "KB" ? v.value * 1e3 : v.value;
        perDay.set(day, (perDay.get(day) ?? 0) + bytes);
      }
    }
    for (const [day, bytes] of perDay) {
      if (day < range.from || day > range.to || day >= range.now.toISOString().slice(0, 10)) continue; // today is still growing: book it tomorrow
      const gb = bytes / 1e9;
      if (gb <= 0) continue;
      const ev = await recordUsage({ provider: "render", sku: "render:bandwidth-gb", units: Math.round(gb * 1e4) / 1e4, unit: "gb", category: "egress", feature: "platform", source: "reported", ref: `render:bandwidth:${day}`, note: "Bandwidth reported by Render, gross of the included allowance", at: new Date(`${day}T12:00:00Z`) });
      if (ev) booked++;
    }
    if (!live.length) notes.push("No running services found.");
    return { booked, facts: t.facts, notes };
  },
};
