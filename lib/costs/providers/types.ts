import "server-only";

/**
 * R1316 provider adapters. Each one holds a read-only token for a provider and does two things: `test` proves the
 * token works and names the account; `sync` books what that provider's public API actually exposes for a date
 * range, idempotently (every row carries a `ref`), and says in `notes` what it cannot see. Nothing is invented:
 * a provider whose API has no usage or invoice endpoint syncs facts only, and the dashboard says so.
 */
export interface SyncRange { from: string; to: string; now: Date }
export interface TestResult { label: string; facts: Record<string, unknown> }
export interface SyncResult { booked: number; facts: Record<string, unknown>; notes: string[] }
export interface Adapter {
  provider: string;
  label: string;
  /** What the admin pastes and where to make it (read-only scope). */
  tokenHelp: string;
  /** Second field beside the token, when the API needs one (team id, org slug). Empty = none. */
  scopeLabel: string;
  scopeHelp: string;
  /** One honest sentence on what this integration can and cannot pull. */
  capability: string;
  test(token: string, scope: string): Promise<TestResult>;
  sync(token: string, scope: string, range: SyncRange): Promise<SyncResult>;
}

export class ProviderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** One JSON GET with a bearer token, 15 s cap, status-aware errors (401/403 read as "token refused"). */
export async function getJson<T>(url: string, token: string, headers: Record<string, string> = {}): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(url, { headers: { accept: "application/json", authorization: `Bearer ${token}`, ...headers }, signal: ctrl.signal });
    if (r.status === 401 || r.status === 403) throw new ProviderError(r.status, "The token was refused. Check it is current and has read access.");
    if (r.status === 404) throw new ProviderError(404, "Not found: check the team, organisation or owner id.");
    if (r.status === 429) throw new ProviderError(429, "Rate limited by the provider; try again in a minute.");
    if (!r.ok) throw new ProviderError(r.status, `HTTP ${r.status} from ${new URL(url).host}`);
    return (await r.json()) as T;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(0, e instanceof Error && e.name === "AbortError" ? "The provider did not answer within 15 s." : (e as Error).message || "Network error");
  } finally {
    clearTimeout(t);
  }
}

export const eachDay = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 86400_000)) out.push(d.toISOString().slice(0, 10));
  return out;
};
