import "server-only";
import { env } from "../env";
import { getConfig, saveConfig, type CalendarConfig } from "../settings";
import { creds, loadKeys } from "../social/keys";

/**
 * R1309 Google Calendar for workshops.
 *
 * Why a connected organiser and not a service account: Meet links and attendee invites only work on a real Google
 * account's calendar (a service account has no Meet and cannot invite guests on consumer Gmail). So the admin connects
 * their Google account once (Admin > Integrations > Google Calendar); we keep the refresh token (encrypted, settings
 * key "calendar") and act as that organiser: one event per published workshop, a Meet link created by Google, every
 * registered creator as a guest. `sendUpdates=all` makes Google send the invite, reschedules and the cancellation,
 * so the schedule lands in each creator's calendar and inbox without us running a mail merge.
 *
 * The OAuth client is the YouTube one (same Google Cloud project "reels", client "Outlly"), with the extra redirect
 * URI /api/admin/integrations/google/callback and the calendar.events scope on its consent screen.
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_CALLBACK_PATH = "/api/admin/integrations/google/callback";
/** The OAuth state cookie the connect route sets and the callback checks (route files may only export handlers). */
export const CALENDAR_STATE_COOKIE = "gcal_state";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

export class CalendarError extends Error {
  constructor(message: string, public code: "NOT_CONNECTED" | "NO_CLIENT" | "GOOGLE" | "REVOKED", public status?: number) {
    super(message);
  }
}

export const calendarCallbackUrl = () => `${env.APP_URL.replace(/\/$/, "")}${CALENDAR_CALLBACK_PATH}`;

/** The Google OAuth client (shared with Continue with Google / YouTube). */
export async function googleClient() {
  await loadKeys();
  const c = creds("youtube");
  if (!c.clientId || !c.clientSecret) throw new CalendarError("Add the Google (YouTube) client ID and secret in Admin > Social platforms first.", "NO_CLIENT");
  return c;
}

/** Where the admin is sent to connect. `state` is the CSRF token the callback checks. */
export async function calendarConnectUrl(state: string): Promise<string> {
  const c = await googleClient();
  const u = new URL(AUTH);
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", calendarCallbackUrl());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", `openid email ${CALENDAR_SCOPE}`);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent"); // a refresh token is only issued when consent is shown
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const r = await fetch(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const j = (await r.json().catch(() => ({}))) as TokenResponse;
  if (!r.ok) {
    if (j.error === "invalid_grant") throw new CalendarError("Google no longer accepts the saved connection (it was revoked or expired). Connect Google Calendar again.", "REVOKED", r.status);
    throw new CalendarError(`Google token request failed: ${j.error_description ?? j.error ?? r.status}`, "GOOGLE", r.status);
  }
  return j;
}

/** The `email` claim of an ID token. It came straight from Google's token endpoint over TLS, so no signature check is needed here. */
export function emailFromIdToken(idToken: string | undefined): string {
  try {
    const [, payload] = (idToken ?? "").split(".");
    if (!payload) return "";
    const j = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { email?: string };
    return typeof j.email === "string" ? j.email.toLowerCase() : "";
  } catch {
    return "";
  }
}

/** The callback: swap the code for tokens and store the organiser. Throws CalendarError on a Google refusal. */
export async function finishCalendarConnect(code: string): Promise<CalendarConfig> {
  const c = await googleClient();
  const t = await tokenRequest({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: calendarCallbackUrl(), grant_type: "authorization_code" });
  if (!t.refresh_token) throw new CalendarError("Google did not return a refresh token. Remove Outlly from your Google account's third-party access and connect again.", "GOOGLE");
  if (!(t.scope ?? "").split(/\s+/).includes(CALENDAR_SCOPE)) throw new CalendarError("The calendar permission was not granted. Tick 'View and edit events on all of your calendars' when Google asks.", "GOOGLE");
  const cfg = await saveConfig("calendar", { google: { refreshToken: t.refresh_token, email: emailFromIdToken(t.id_token), calendarId: "primary", connectedAt: new Date().toISOString(), scope: t.scope ?? CALENDAR_SCOPE } });
  tokenCache.delete("google");
  return cfg;
}

export async function disconnectCalendar() {
  const cur = await getConfig("calendar");
  if (cur.google.refreshToken) {
    // Best effort: tell Google too, so the account's third-party access list is clean.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cur.google.refreshToken)}`, { method: "POST" }).catch(() => {});
  }
  tokenCache.delete("google");
  return saveConfig("calendar", { google: { refreshToken: "", email: "", calendarId: "primary", connectedAt: "", scope: "" } });
}

/** What the admin page shows. Never the token. */
export async function calendarStatus(): Promise<{ connected: boolean; email: string; connectedAt: string; calendarId: string; clientReady: boolean }> {
  const [cfg] = await Promise.all([getConfig("calendar"), loadKeys()]);
  const c = creds("youtube");
  return { connected: !!cfg.google.refreshToken, email: cfg.google.email, connectedAt: cfg.google.connectedAt, calendarId: cfg.google.calendarId || "primary", clientReady: !!c.clientId && !!c.clientSecret };
}

export const calendarConnected = async () => !!(await getConfig("calendar")).google.refreshToken;

// Access tokens live ~1 h; cached per instance and refreshed a minute early.
const g = globalThis as unknown as { __gcalTok?: Map<string, { token: string; exp: number }> };
const tokenCache = (g.__gcalTok ??= new Map());

async function accessToken(): Promise<string> {
  const hit = tokenCache.get("google");
  if (hit && hit.exp > Date.now()) return hit.token;
  const cfg = await getConfig("calendar");
  if (!cfg.google.refreshToken) throw new CalendarError("Google Calendar is not connected. Connect it in Admin > Integrations.", "NOT_CONNECTED");
  const c = await googleClient();
  const t = await tokenRequest({ refresh_token: cfg.google.refreshToken, client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token" });
  if (!t.access_token) throw new CalendarError("Google returned no access token.", "GOOGLE");
  tokenCache.set("google", { token: t.access_token, exp: Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000 });
  return t.access_token;
}

async function api<T>(method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<T> {
  const cfg = await getConfig("calendar");
  const cal = encodeURIComponent(cfg.google.calendarId || "primary");
  const u = new URL(`${API}/calendars/${cal}${path}`);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  const run = async (token: string) =>
    fetch(u, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let r = await run(await accessToken());
  if (r.status === 401) {
    tokenCache.delete("google");
    r = await run(await accessToken());
  }
  if (r.status === 204) return undefined as T;
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } } & T;
  if (!r.ok) {
    const msg = j.error?.message ?? `HTTP ${r.status}`;
    throw new CalendarError(`Google Calendar: ${msg}`, "GOOGLE", r.status);
  }
  return j;
}

export interface CalendarEventInput {
  /** Stable per workshop; also the Meet createRequest id, so a retried insert never makes two Meet rooms. */
  key: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  /** The workshop page, shown as the event's source link. */
  url: string;
  attendees: { email: string; name?: string }[];
}

export interface CalendarEvent {
  id: string;
  meetUrl: string;
  htmlLink: string;
}

type GEvent = { id?: string; hangoutLink?: string; htmlLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } };

const meetOf = (e: GEvent) => e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? "";

function eventBody(i: CalendarEventInput, withMeet: boolean) {
  return {
    summary: i.title,
    description: `${i.description}\n\n${i.url}`.trim(),
    start: { dateTime: i.startsAt.toISOString(), timeZone: i.timezone },
    end: { dateTime: i.endsAt.toISOString(), timeZone: i.timezone },
    attendees: i.attendees.map((a) => ({ email: a.email, displayName: a.name || undefined })),
    // Creators must not see each other's email addresses, and must not be able to grow the guest list.
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    reminders: { useDefault: false, overrides: [{ method: "email", minutes: 24 * 60 }, { method: "popup", minutes: 30 }] },
    source: { title: "Outlly workshop", url: i.url },
    ...(withMeet ? { conferenceData: { createRequest: { requestId: i.key, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
}

/** Create the event with a Meet room; Google emails every attendee the invite. */
export async function createCalendarEvent(i: CalendarEventInput): Promise<CalendarEvent> {
  const e = await api<GEvent>("POST", "/events", eventBody(i, true), { conferenceDataVersion: "1", sendUpdates: "all" });
  return { id: e.id ?? "", meetUrl: meetOf(e), htmlLink: e.htmlLink ?? "" };
}

/** Time, text or guest list changed: patch, and Google emails the update (new guests get the invite). */
export async function updateCalendarEvent(eventId: string, i: CalendarEventInput): Promise<CalendarEvent> {
  const e = await api<GEvent>("PATCH", `/events/${encodeURIComponent(eventId)}`, eventBody(i, false), { conferenceDataVersion: "1", sendUpdates: "all" });
  return { id: e.id ?? eventId, meetUrl: meetOf(e), htmlLink: e.htmlLink ?? "" };
}

/** Cancel: Google emails every attendee the cancellation and removes it from their calendars. A 404/410 counts as done. */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  try {
    await api<void>("DELETE", `/events/${encodeURIComponent(eventId)}`, undefined, { sendUpdates: "all" });
  } catch (e) {
    if (e instanceof CalendarError && (e.status === 404 || e.status === 410)) return;
    throw e;
  }
}

/** Test hook. */
export function __resetCalendarTokens() {
  tokenCache.clear();
}
