import "server-only";
import { z } from "zod";
import { db } from "../db";
import { HttpError } from "../http";
import { adminEvent } from "../admin/route";
import { decrypt, encrypt } from "../crypto";
import { dayKey } from "./core";
import { raiseAlert } from "./manual";
import { ADAPTERS, adapterFor, type SyncResult } from "./providers";

/**
 * R1316 provider connections: one read-only token per provider, encrypted at rest, tested on save, synced by the
 * sweep. The token is decrypted only inside `withToken` on the server; the API and the page see `last4`. A failed
 * sync marks the connection and raises one alert per provider per day, never twice for the same day.
 */
export const ConnectionBody = z.object({
  provider: z.enum(ADAPTERS.map((a) => a.provider) as [string, ...string[]]),
  token: z.string().trim().min(8).max(4000),
  scope: z.string().trim().max(120).default(""),
});

export interface ConnectionView { id: string; provider: string; providerLabel: string; label: string; last4: string; scope: string; status: string; lastError: string; lastTestAt: string | null; lastSyncAt: string | null; facts: Record<string, unknown>; capability: string; tokenHelp: string; scopeLabel: string; scopeHelp: string }

const parseFacts = (s: string) => { try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; } };
const view = (c: Awaited<ReturnType<typeof db.costProviderConnection.findFirstOrThrow>>): ConnectionView => {
  const a = adapterFor(c.provider)!;
  return { id: c.id, provider: c.provider, providerLabel: a.label, label: c.label, last4: c.last4, scope: c.scope, status: c.status, lastError: c.lastError, lastTestAt: c.lastTestAt?.toISOString() ?? null, lastSyncAt: c.lastSyncAt?.toISOString() ?? null, facts: parseFacts(c.facts), capability: a.capability, tokenHelp: a.tokenHelp, scopeLabel: a.scopeLabel, scopeHelp: a.scopeHelp };
};

/** Every adapter, connected or not, so the card can show what is possible. */
export async function listConnections(): Promise<ConnectionView[]> {
  const rows = await db.costProviderConnection.findMany();
  return ADAPTERS.map((a) => {
    const c = rows.find((r) => r.provider === a.provider);
    return c ? view(c) : { id: "", provider: a.provider, providerLabel: a.label, label: "", last4: "", scope: "", status: "none", lastError: "", lastTestAt: null, lastSyncAt: null, facts: {}, capability: a.capability, tokenHelp: a.tokenHelp, scopeLabel: a.scopeLabel, scopeHelp: a.scopeHelp };
  });
}

/** Save (or replace) a provider's token after proving it works. A refused token is not stored. */
export async function connectProvider(input: unknown, by: { login: string }) {
  const b = ConnectionBody.parse(input);
  const a = adapterFor(b.provider)!;
  const now = new Date();
  let t: Awaited<ReturnType<typeof a.test>>;
  try { t = await a.test(b.token, b.scope); }
  catch (e) { throw new HttpError(400, `${a.label} did not accept the token: ${(e as Error).message}`, "PROVIDER_REFUSED"); }
  const data = { label: t.label, tokenEnc: encrypt(b.token), last4: b.token.slice(-4), scope: b.scope, status: "ok", lastError: "", lastTestAt: now, facts: JSON.stringify(t.facts), createdBy: by.login };
  const row = await db.costProviderConnection.upsert({ where: { provider: b.provider }, create: { provider: b.provider, ...data }, update: data });
  await adminEvent("costs", `${a.label} connected (${t.label})`, by.login, "/admin/costs");
  return view(row);
}

/** `id` may be the row id or the provider name (the card works per provider). */
export async function removeConnection(id: string, by: { login: string }) {
  const c = await db.costProviderConnection.findFirst({ where: { OR: [{ id }, { provider: id }] } });
  if (!c) throw new HttpError(404, "No such connection.", "NOT_FOUND");
  await db.costProviderConnection.delete({ where: { id: c.id } });
  await adminEvent("costs", `${c.provider} disconnected`, by.login, "/admin/costs");
}

async function withToken<T>(provider: string, fn: (token: string, scope: string, id: string) => Promise<T>) {
  const c = await db.costProviderConnection.findUnique({ where: { provider } });
  if (!c) throw new HttpError(404, `${provider} is not connected.`, "NOT_FOUND");
  return fn(decrypt(c.tokenEnc), c.scope, c.id);
}

/** Re-run the adapter's test (token still good? plan changed?) and record the outcome. */
export async function testConnection(provider: string) {
  const a = adapterFor(provider);
  if (!a) throw new HttpError(404, "Unknown provider.", "NOT_FOUND");
  return withToken(provider, async (token, scope, id) => {
    const now = new Date();
    try {
      const t = await a.test(token, scope);
      return view(await db.costProviderConnection.update({ where: { id }, data: { label: t.label, status: "ok", lastError: "", lastTestAt: now, facts: JSON.stringify(t.facts) } }));
    } catch (e) {
      return view(await db.costProviderConnection.update({ where: { id }, data: { status: "error", lastError: (e as Error).message, lastTestAt: now } }));
    }
  });
}

/** Default sync window: the last three days up to now, so a late metric or a skipped night is picked up; refs keep it idempotent. */
export const syncRange = (now: Date, days = 3) => ({ from: dayKey(new Date(now.getTime() - (days - 1) * 86400_000)), to: dayKey(now), now });

/** Pull one provider for a range. Books through the ledger (idempotent refs), stores facts, marks status; errors become one alert per provider per day. */
export async function syncProvider(provider: string, range = syncRange(new Date())): Promise<{ provider: string; ok: boolean; result?: SyncResult; error?: string }> {
  const a = adapterFor(provider);
  if (!a) throw new HttpError(404, "Unknown provider.", "NOT_FOUND");
  return withToken(provider, async (token, scope, id) => {
    try {
      const result = await a.sync(token, scope, range);
      await db.costProviderConnection.update({ where: { id }, data: { status: "ok", lastError: "", lastSyncAt: range.now, facts: JSON.stringify(result.facts) } });
      return { provider, ok: true, result };
    } catch (e) {
      const error = (e as Error).message || "Sync failed";
      await db.costProviderConnection.update({ where: { id }, data: { status: "error", lastError: error, lastSyncAt: range.now } });
      await raiseAlert({ key: `sync:${provider}:${dayKey(range.now)}`, kind: "sync", severity: "warn", title: `${a.label} sync failed`, body: error });
      return { provider, ok: false, error };
    }
  });
}

/** Every connected provider, one after another (the sweep's slot). */
export async function syncAll(now = new Date()) {
  const rows = await db.costProviderConnection.findMany({ select: { provider: true } });
  const out = [];
  for (const r of rows) out.push(await syncProvider(r.provider, syncRange(now)).catch((e) => ({ provider: r.provider, ok: false as const, error: (e as Error).message })));
  return out;
}
