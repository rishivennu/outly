import "server-only";
import { db } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import type { AdminSession } from "@/lib/admin/auth";
import { CURRENCIES, formatMoney, type Currency } from "@/lib/billing/money";
import { localPrice, parsePrices } from "@/lib/billing/currency";
import { hasYearly, priceFor } from "@/lib/billing/cycle";
import { normalizeDisplay } from "@/lib/billing/display";
import { revalidatePricing } from "@/lib/billing/plans";
import { getConfig } from "@/lib/settings";
import {
  floorMinor, getEconomics, getPolicy, marginFor, normalizeEconomics, normalizePolicy, savePolicy, saveEconomics, typicalCostInrMinor, undoPolicy, validatePolicy, yearlyFromMonthly,
  POLICY_PREV_KEY, type Economics, type FieldError as CoreFieldError, type RiskWeights, type SubsPolicy,
} from "@/lib/subscriptions";
import type { EconState, FieldError, GridRow, NumField, PolicyForm, PolicyState, Preview } from "@/app/admin/(panel)/subscriptions/_components/api";
import { subsAudit } from "./report";

type Admin = Pick<AdminSession, "login" | "role" | "name">;

const GRID_CURRENCIES: readonly Currency[] = ["INR", "USD", "EUR", "GBP"];
const RISK_LABEL: Record<keyof RiskWeights, string> = {
  device: "Same device as a past offer", payment: "Same payment method", email: "Same inbox", netUa: "Same network and browser (30 days)", burst: "3+ signups on one network in 24 h",
  ip: "Same IP only", ipCap: "Cap on IP-only points", phoneNew: "New verified phone", tenure: "Account older than 60 days", high: "High risk from score", medium: "Medium risk from score",
};

export const policyTarget = async () => (await getPolicy()).targetMargin;

const refuse = (errors: CoreFieldError[], fallback = "That change was refused.") => new HttpError(400, errors[0]?.message || fallback, "POLICY_INVALID", { errors });

/** adminRoute answers an HttpError with only its message, so a refusal's field errors are sent from here. */
export async function withFieldErrors(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof HttpError && e.code === "POLICY_INVALID") return json({ error: e.message, code: e.code, ...e.extra }, { status: e.status });
    throw e;
  }
}

export function toForm(p: SubsPolicy): PolicyForm {
  const intro: PolicyForm["intro"] = {};
  for (const [slug, prices] of Object.entries(p.intro)) intro[slug] = Object.fromEntries(Object.entries(prices).filter(([, v]) => typeof v === "number")) as Record<string, number>;
  return {
    intro, graceDays: p.graceDays, trialDays: p.trialDays, budgetMode: p.budget.mode, refundWindowDays: p.refundWindowDays,
    risk: (Object.keys(RISK_LABEL) as (keyof RiskWeights)[]).map((k) => ({ path: k, label: RISK_LABEL[k], value: p.risk[k] })),
  };
}

/** Only the fields the editor owns; everything else on the stored policy is left as it is. */
export function fromForm(f: PolicyForm, cur: SubsPolicy): Partial<SubsPolicy> {
  const risk = { ...cur.risk };
  for (const r of f.risk) if (r.path in RISK_LABEL) risk[r.path as keyof RiskWeights] = Math.round(r.value);
  const intro: SubsPolicy["intro"] = {};
  for (const [slug, prices] of Object.entries(f.intro)) intro[slug] = parsePrices(prices);
  return { intro, graceDays: f.graceDays, trialDays: f.trialDays, budget: { ...cur.budget, mode: f.budgetMode }, refundWindowDays: f.refundWindowDays, risk };
}

/** First-time and returning price per paid plan, currency and cycle, each against its floor at the policy's target margin. */
export async function marginGrid(p: SubsPolicy, econ: Economics): Promise<{ grid: GridRow[]; plans: { slug: string; name: string }[]; currencies: string[] }> {
  const slugs = Object.keys(p.intro);
  const [rows, display] = await Promise.all([db.plan.findMany({ where: { slug: { in: slugs } } }), getConfig("pricing").then(normalizeDisplay)]);
  const currencies = CURRENCIES.filter((c) => GRID_CURRENCIES.includes(c) || slugs.some((s) => p.intro[s]?.[c] != null));
  const plans = slugs.map((slug) => ({ slug, name: rows.find((r) => r.slug === slug)?.name ?? slug }));
  const grid: GridRow[] = [];
  for (const { slug, name } of plans) {
    const row = rows.find((r) => r.slug === slug);
    const plan = row ? { ...row, prices: parsePrices(row.prices), yearlyPrices: parsePrices(row.yearlyPrices) } : null;
    const cost = typicalCostInrMinor(slug, econ);
    const yearly = !!plan && hasYearly(plan, display.yearly);
    for (const cur of currencies) {
      for (const interval of ["month", "year"] as const) {
        const floor = floorMinor({ plan: slug, currency: cur, interval, econ, target: p.targetMargin });
        const intoRow = (tier: GridRow["tier"], price: number | null): GridRow => {
          const margin = price != null && price > 0 ? marginFor({ priceMinor: price, currency: cur, interval, costMinorInr: cost, econ }).margin : null;
          return { plan: slug, planName: name, currency: cur, interval, tier, priceMinor: price, floorMinor: floor, margin, ok: price == null || floor <= 0 || price >= floor };
        };
        let std: number | null = null;
        if (plan && plan.priceMinor > 0 && plan.interval === "month") {
          if (interval === "month") std = localPrice(plan, cur).priceMinor;
          else if (yearly) std = Math.max(priceFor(plan, cur, "year", display.freeMonths).priceMinor, floor);
        }
        const monthlyIntro = p.intro[slug]?.[cur] ?? null;
        let intro: number | null = null;
        if (monthlyIntro != null) {
          if (interval === "month") intro = monthlyIntro;
          else if (yearly) {
            const y = yearlyFromMonthly({ plan: slug, currency: cur, monthlyMinor: monthlyIntro, econ, target: p.targetMargin });
            intro = std != null ? Math.min(std, y) : y;
          }
        }
        grid.push(intoRow("intro", intro), intoRow("standard", std));
      }
    }
  }
  return { grid, plans, currencies };
}

async function prevInfo(cur: SubsPolicy): Promise<PolicyState["prev"]> {
  const row = await db.setting.findUnique({ where: { key: POLICY_PREV_KEY } });
  if (!row) return null;
  try {
    const prev = normalizePolicy(JSON.parse(row.value));
    return { at: cur.updatedAt ?? row.updatedAt.toISOString(), by: cur.updatedBy ?? "admin", version: prev.version, enabled: prev.enabled };
  } catch {
    return null;
  }
}

export async function policyState(): Promise<PolicyState> {
  const [p, econ] = await Promise.all([getPolicy(), getEconomics()]);
  const [{ grid, plans, currencies }, errors, prev] = await Promise.all([marginGrid(p, econ), validatePolicy(p, econ), prevInfo(p)]);
  return { enabled: p.enabled, version: p.version, targetMargin: p.targetMargin, form: toForm(p), plans, currencies, grid, errors, prev };
}

/** The live check behind the editor: the same validation savePolicy runs, without writing. */
export async function checkForm(form: PolicyForm): Promise<{ grid: GridRow[]; errors: FieldError[] }> {
  const [cur, econ] = await Promise.all([getPolicy(), getEconomics()]);
  const draft = normalizePolicy({ ...cur, ...fromForm(form, cur) });
  const [{ grid }, errors] = await Promise.all([marginGrid(draft, econ), validatePolicy(draft, econ)]);
  return { grid, errors };
}

const summary = (p: SubsPolicy) => ({ enabled: p.enabled, version: p.version, intro: p.intro, graceDays: p.graceDays, trialDays: p.trialDays, budget: p.budget, risk: p.risk, refundWindowDays: p.refundWindowDays });

export async function saveForm(form: PolicyForm, admin: Admin): Promise<PolicyState> {
  const before = await getPolicy();
  const r = await savePolicy(fromForm(form, before), admin.login);
  if (!r.ok) throw refuse(r.errors);
  await subsAudit(admin, { action: "subs.policy.save", targetType: "config", targetId: "subs.policy", before: summary(before), after: summary(r.value), title: `${admin.name} edited the subscription policy`, body: `Version ${r.value.version}${r.value.enabled ? ", live" : ", off"}` });
  if (r.value.enabled) revalidatePricing();
  return policyState();
}

/** What turning the policy on would do, before it happens. */
export async function previewEnable(): Promise<Preview> {
  const now = new Date();
  const [p, econ] = await Promise.all([getPolicy(), getEconomics()]);
  const live = { status: "active", sample: false, currentPeriodEnd: { gt: now } };
  const [activeSubs, founding, trialsActive, plans] = await Promise.all([
    db.subscription.count({ where: live }),
    db.subscription.count({ where: { ...live, user: { foundingNo: { not: null } } } }),
    db.trial.count({ where: { status: "active" } }),
    db.plan.findMany({ where: { slug: { in: Object.keys(p.intro) } } }),
  ]);
  const changes: string[] = [];
  for (const plan of plans) {
    const intro = p.intro[plan.slug]?.INR;
    if (intro == null || plan.priceMinor <= 0) continue;
    const std = localPrice({ ...plan, prices: parsePrices(plan.prices) }, "INR").priceMinor;
    const m = marginFor({ priceMinor: intro, currency: "INR", interval: "month", costMinorInr: typicalCostInrMinor(plan.slug, econ), econ }).margin;
    changes.push(`${plan.name}: first-time ${formatMoney(intro, "INR")}/mo, returning ${formatMoney(std, "INR")}/mo, typical margin ${Math.round(m * 100)}%.`);
  }
  changes.push(p.trialDays > 0 ? `A ${p.trialDays}-day ${p.trialPlanSlug} trial becomes available, once per person.` : "Trials stay off (trial days is 0).");
  changes.push(p.budget.mode === "off" ? "No monthly cost budget." : p.budget.mode === "alert" ? `Cost budget in alert mode: the meter warns at ${p.budget.warnPct}%, nothing pauses.` : `Cost budget enforced: at 100% only AI, captions and X posts pause until next month or a pack.`);
  return { activeSubs, legacy: Math.max(0, activeSubs - founding), founding, trialsActive, changes };
}

export async function runPolicyAction(action: "enable" | "disable" | "undo", admin: Admin): Promise<PolicyState> {
  const before = await getPolicy();
  const r = action === "undo" ? await undoPolicy(admin.login) : await savePolicy({ enabled: action === "enable" }, admin.login);
  if (!r.ok) throw refuse(r.errors);
  const title = action === "enable" ? `${admin.name} enabled first-time pricing and trials` : action === "disable" ? `${admin.name} turned the subscription policy off` : `${admin.name} undid the last subscription policy change`;
  await subsAudit(admin, { action: `subs.policy.${action}`, targetType: "config", targetId: "subs.policy", before: summary(before), after: summary(r.value), title, body: `Version ${before.version} to ${r.value.version}` });
  revalidatePricing();
  return policyState();
}

// ------------------------------------------------------------------ cost rates (subs.economics)

const GROUP_LABEL: Record<string, string> = { fx: "INR per", gstRate: "GST rate", feeShare: "Fee share", rates: "INR per unit", fixedMonthly: "Fixed INR / month", typicalCost: "Typical cost INR / month", fullCost: "Full-allowance cost INR / month", typicalUsage: "Typical usage" };

/** Every number in the cost model as an editable field, addressed by its dotted path. */
export function flattenEconomics(e: Economics): NumField[] {
  const out: NumField[] = [];
  const walk = (v: unknown, path: string[]) => {
    if (typeof v === "number") {
      if (path.join(".") === "fx.INR") return;
      const [g, ...rest] = path;
      out.push({ path: path.join("."), label: [GROUP_LABEL[g] ?? g, ...rest].join(" ").trim(), value: v });
    } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  walk(e, []);
  return out;
}

/** Applies dotted-path edits onto a copy of the current model. Unknown paths are refused, never invented. */
export function applyEconValues(cur: Economics, values: Record<string, number>): { next: Economics; errors: FieldError[] } {
  const known = new Set(flattenEconomics(cur).map((f) => f.path));
  const next = JSON.parse(JSON.stringify(cur)) as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const [path, v] of Object.entries(values)) {
    if (!known.has(path)) {
      errors.push({ field: path, message: "That rate doesn't exist." });
      continue;
    }
    const keys = path.split(".");
    let o = next;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys[keys.length - 1]] = v;
  }
  return { next: next as unknown as Economics, errors };
}

export async function econState(errors: FieldError[] = []): Promise<EconState> {
  return { fields: flattenEconomics(await getEconomics()), errors };
}

/** Saves rate edits. Refused when they would leave any first-time price under its new floor. */
export async function saveEconValues(values: Record<string, number>, admin: Admin): Promise<EconState> {
  const [cur, policy] = await Promise.all([getEconomics(), getPolicy()]);
  const { next, errors } = applyEconValues(cur, values);
  if (errors.length) throw refuse(errors);
  const under = await validatePolicy(policy, normalizeEconomics(next));
  const floors = under.filter((e) => e.code === "below_floor");
  if (floors.length) {
    const what = floors.map((e) => e.field.replace(/^(intro|standard)\./, "").replace(".", " ")).join(", ");
    throw refuse([{ field: "", message: `These rates would put prices under their margin floor (${what}). Raise those prices on the Policy tab or in Plans first.` }]);
  }
  const r = await saveEconomics(next, admin.login);
  if (!r.ok) throw refuse(r.errors);
  const changed = Object.keys(values).filter((k) => flattenEconomics(cur).find((f) => f.path === k)?.value !== values[k]);
  await subsAudit(admin, { action: "subs.economics.save", targetType: "config", targetId: "subs.economics", before: Object.fromEntries(flattenEconomics(cur).filter((f) => changed.includes(f.path)).map((f) => [f.path, f.value])), after: Object.fromEntries(changed.map((k) => [k, values[k]])), title: `${admin.name} updated cost rates`, body: `${changed.length} rate${changed.length === 1 ? "" : "s"} changed` });
  return econState();
}
