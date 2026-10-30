"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Info, Loader2, MapPin, Minus, Plus, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { agoLabel, LIVE_POLL_MS, LIVE_TIMEOUTS_MIN, type LiveMap, type LivePlace } from "@/lib/live-map-core";
import type { GlobeHandle } from "./LiveGlobeCanvas";

// The canvas is its own chunk, loaded after the card has painted; the card works (list, counts) without it.
const LiveGlobeCanvas = dynamic(() => import("./LiveGlobeCanvas"), { ssr: false, loading: () => <span className="lg-ph" aria-hidden="true" /> });

const PREF = "outlly.admin.liveTimeout";
const hhmmss = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
function placeTitle(p: LivePlace) {
  return p.city ? `${p.city}, ${countryName(p.country)}` : countryName(p.country);
}

/**
 * Admin overview: who is using Outlly right now, on the waitlist's globe (1062).
 * Polls every 15 s while the tab is visible (presence itself is written once a minute, so a push channel would not
 * be any fresher), re-reads at once when the tab comes back, and has a manual Refresh. Keeps the last good data on
 * a failed read and says why.
 */
export function LiveGlobeCard({ initial }: { initial: LiveMap }) {
  const [data, setData] = useState<LiveMap>(initial);
  const [timeout, setTimeoutMin] = useState(initial.timeoutMin);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<{ lite: boolean; still: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.parse(initial.at));
  const [said, setSaid] = useState("");
  const handle = useRef<GlobeHandle | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const prevActive = useRef(initial.active);

  // Device class decides the globe: full motion on a desktop, the light version on touch / small / Save-Data.
  useEffect(() => {
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const lite = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const set = () => setMode({ lite: lite || rm.matches, still: rm.matches });
    set();
    rm.addEventListener("change", set);
    try {
      const saved = Number(localStorage.getItem(PREF));
      if ((LIVE_TIMEOUTS_MIN as readonly number[]).includes(saved)) setTimeoutMin(saved);
    } catch {}
    return () => rm.removeEventListener("change", set);
  }, []);

  const load = useCallback(async (t: number, manual = false) => {
    inflight.current?.abort();
    const ctl = new AbortController();
    inflight.current = ctl;
    if (manual) setBusy(true);
    const kill = setTimeout(() => ctl.abort(), 12_000);
    try {
      if (navigator.onLine === false) throw new Error("You're offline. The globe shows the last data it had.");
      const r = await fetch(`/api/admin/live?timeout=${t}`, { cache: "no-store", credentials: "same-origin", signal: ctl.signal });
      if (r.status === 401) throw new Error("Your admin session ended. Sign in again to keep the globe live.");
      if (r.status === 403) throw new Error("Your role can't see live users. Ask a super admin.");
      if (r.status === 429) throw new Error("Refreshing too often. It will pick up again in a moment.");
      if (!r.ok) throw new Error("The server didn't answer. Showing the last data.");
      const next = (await r.json()) as LiveMap;
      setData(next);
      setNow(Date.parse(next.at));
      setErr(null);
      if (next.active !== prevActive.current) setSaid(`${next.active} active ${next.active === 1 ? "user" : "users"} now`);
      prevActive.current = next.active;
    } catch (e) {
      if (ctl.signal.aborted && inflight.current !== ctl) return; // replaced by a newer read
      setErr(e instanceof Error && e.name !== "AbortError" && !/fetch/i.test(e.message) ? e.message : "Couldn't reach Outlly. Showing the last data.");
    } finally {
      clearTimeout(kill);
      if (inflight.current === ctl) {
        inflight.current = null;
        setBusy(false);
      }
    }
  }, []);

  // Poll while visible; read at once on return. Restarts when the timeout changes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = () => {
      timer = setTimeout(async () => {
        if (!document.hidden) await load(timeout);
        loop();
      }, LIVE_POLL_MS);
    };
    if (timeout !== initial.timeoutMin || Date.now() - Date.parse(initial.at) > 5_000) void load(timeout);
    loop();
    const vis = () => {
      if (!document.hidden) void load(timeout);
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [timeout, load, initial.timeoutMin, initial.at]);

  // "4 min ago" labels keep ageing between reads.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const place = useMemo(() => data.places.find((p) => p.key === selected) ?? null, [data, selected]);
  // A place that empties out closes its panel instead of showing a stale list.
  useEffect(() => {
    if (selected && !place) setSelected(null);
  }, [selected, place]);

  const choose = (k: string | null) => {
    setSelected(k);
    if (k) handle.current?.focus(k);
  };
  const changeTimeout = (t: number) => {
    setTimeoutMin(t);
    try {
      localStorage.setItem(PREF, String(t));
    } catch {}
  };

  const activePlaces = data.places.filter((p) => p.active > 0).length;
  const updated = new Date(data.at);

  return (
    <section className="lg-card" aria-labelledby="lg-title">
      <header className="lg-head">
        <div className="min-w-0">
          <p className="lg-eyebrow">
            <span className="lg-live" aria-hidden="true" /> Live
          </p>
          <h2 id="lg-title" className="mt-2 font-display text-[1.2rem] font-bold tracking-[-0.02em] text-white">Who's using Outlly now</h2>
          <p className="mt-1 text-[13px] text-white/70">Approximate locations from each member's network. Never exact.</p>
        </div>
        <div className="lg-controls">
          <label className="lg-select">
            <span className="text-white/70">Inactive after</span>
            <select value={timeout} onChange={(e) => changeTimeout(Number(e.target.value))} aria-label="Inactivity timeout">
              {LIVE_TIMEOUTS_MIN.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="lg-btn" onClick={() => void load(timeout, true)} disabled={busy} aria-busy={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            {busy ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="lg-stats" role="group" aria-label="Live counts">
        <div>
          <p className="lg-num tabular">{data.active.toLocaleString("en")}</p>
          <p className="lg-lbl">active now</p>
        </div>
        <div>
          <p className="lg-num lg-num-sm tabular">{data.idle.toLocaleString("en")}</p>
          <p className="lg-lbl">idle, last hour</p>
        </div>
        <div>
          <p className="lg-num lg-num-sm tabular">{activePlaces.toLocaleString("en")}</p>
          <p className="lg-lbl">{activePlaces === 1 ? "place" : "places"} active</p>
        </div>
        <p className="lg-upd">
          {err ? (
            <span role="alert" className="inline-flex items-center gap-1.5 text-[#ffd27a]">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> {err}
            </span>
          ) : (
            <>Updated {hhmmss(updated)} · every 15 s</>
          )}
        </p>
        <span className="sr-only" aria-live="polite">
          {said}
        </span>
      </div>

      <div className="lg-body">
        <div className="lg-stage">
          {mode ? (
            <LiveGlobeCanvas places={data.places} selected={selected} onSelect={choose} lite={mode.lite} still={mode.still} onSlow={() => setMode({ lite: true, still: mode.still })} handle={handle} />
          ) : (
            <span className="lg-ph" aria-hidden="true" />
          )}
          <div className="lg-zoom" role="group" aria-label="Globe view">
            <button type="button" onClick={() => handle.current?.zoomBy(1.3)} aria-label="Zoom in">
              <Plus className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => handle.current?.zoomBy(1 / 1.3)} aria-label="Zoom out">
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => handle.current?.reset()} aria-label="Reset view">
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="lg-hint">Drag to turn. Pinch, or click the globe and scroll, to zoom.</p>
          <div className="lg-legend" aria-hidden="true">
            <span><i className="lg-dot" /> Active</span>
            <span><i className="lg-dot lg-dot-idle" /> Idle</span>
          </div>
        </div>

        <div className="lg-side">
          {place ? (
            <PlacePanel place={place} now={now} timeout={data.timeoutMin} onBack={() => setSelected(null)} />
          ) : (
            <>
              <h3 className="lg-side-h">Places</h3>
              {data.places.length === 0 ? (
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/75">
                  Nobody has used Outlly in the last hour{data.unplaced.active + data.unplaced.idle > 0 ? " from a place we can map" : ""}. Markers appear here as members open the studio.
                </p>
              ) : (
                <ul className="lg-places">
                  {data.places.map((p) => (
                    <li key={p.key}>
                      <button type="button" onClick={() => choose(p.key)} className="lg-place">
                        <span className={p.active > 0 ? "lg-dot" : "lg-dot lg-dot-idle"} aria-hidden="true" />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-[14px] font-semibold text-white">{placeTitle(p)}</span>
                          <span className="block text-[12.5px] text-white/65">
                            {p.active > 0 ? `${p.active} active` : "No one active"}
                            {p.idle > 0 ? ` · ${p.idle} idle` : ""} · {agoLabel(p.lastSeenAt, now)}
                          </span>
                        </span>
                        <span className="lg-cc" aria-hidden="true">{p.country}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {data.unplaced.active + data.unplaced.idle > 0 && (
                <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-snug text-white/65">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {data.unplaced.active} active and {data.unplaced.idle} idle without a known location (VPN or Tor, a network that hides it, or no studio visit yet). Counted above, not on the map.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <details className="lg-def">
        <summary>
          <Info className="h-3.5 w-3.5" aria-hidden /> What counts as active, and how location works
        </summary>
        <ul>
          <li><b>Active</b>: a signed-in member whose app checked in within the last {data.timeoutMin} minutes. The studio checks in once a minute while it is open.</li>
          <li><b>Idle</b>: checked in within the last hour, but not in the last {data.timeoutMin} minutes. Anyone quieter than an hour is not shown.</li>
          <li><b>Location</b>: the country, and the city when our network provider reports one, from the member's last studio visit. It is the network's place, not the person's: a VPN, office network or mobile carrier can put them in another city or country. Places without a mapped city sit at the country's centre.</li>
          <li><b>Privacy</b>: this view never shows IP addresses or coordinates, and stores nothing new. Only admins with access to Users can open it. Sample accounts are left out.</li>
        </ul>
      </details>
    </section>
  );
}

function PlacePanel({ place, now, timeout, onBack }: { place: LivePlace; now: number; timeout: number; onBack: () => void }) {
  const country = countryName(place.country);
  return (
    <div>
      <button type="button" onClick={onBack} className="lg-back">
        <ChevronLeft className="h-4 w-4" aria-hidden /> All places
      </button>
      <h3 className="mt-2 font-display text-[1.1rem] font-bold leading-tight text-white">{place.city ?? country}</h3>
      <p className="mt-0.5 text-[13px] text-white/70">
        {place.city ? `${place.people[0]?.region && place.people[0].region !== place.city ? `${place.people[0].region}, ` : ""}${country}` : "City not reported. Shown at the country's centre."}
      </p>
      <dl className="lg-facts">
        <div>
          <dt>Active</dt>
          <dd className="tabular">{place.active}</dd>
        </div>
        <div>
          <dt>Idle</dt>
          <dd className="tabular">{place.idle}</dd>
        </div>
        <div>
          <dt>Last active</dt>
          <dd>{agoLabel(place.lastSeenAt, now)}</dd>
        </div>
      </dl>
      <p className="mt-1 text-[12px] text-white/55">Approximate, from the network. Active means seen in the last {timeout} minutes.</p>
      <ul className="lg-people">
        {place.people.slice(0, 50).map((u) => (
          <li key={u.id}>
            <span className={u.status === "active" ? "lg-dot" : "lg-dot lg-dot-idle"} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <a href={`/admin/users?q=${encodeURIComponent(u.email)}`} className="block truncate text-[13.5px] font-semibold text-white underline-offset-2 hover:underline">
                {u.name || u.email}
              </a>
              <span className="block text-[12px] text-white/60">
                {u.status === "active" ? "Active" : "Idle"} · last active {agoLabel(u.lastSeenAt, now)}
                {u.locAt ? ` · place seen ${agoLabel(u.locAt, now)}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {place.people.length > 50 && <p className="mt-2 text-[12px] text-white/60">And {place.people.length - 50} more.</p>}
    </div>
  );
}
