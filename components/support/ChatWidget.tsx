"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowDown, ArrowUp, BarChart3, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, CreditCard, Globe, Headset, Loader2, Maximize2, Minimize2, RotateCw, SquarePen, X } from "lucide-react";
import { Pip, type PipMood } from "@/components/brand/Pip";
import { useMaybeUser } from "@/components/shell/UserContext";
import { hasSignedInHint } from "@/components/marketing/useSignedIn";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { Answer } from "./Answer";
import { PipDataCard } from "./PipDataCard";
import { pipFont } from "./font";
import type { PipResult } from "@/lib/pip/types";
import type { Insight } from "@/lib/pip/analytics-core";
import { CX, LANGS, PIP_DATA, T, langDir, pipHome, readLang, resolveT, writeLang, type Lang, type PipTopicId } from "@/lib/i18n/support";
import { HUMAN_RE } from "@/lib/support/smalltalk";
import { liveSysLine, liveT, type LiveT } from "@/lib/i18n/live";
import { mergeLive, receipt, type CustomerState, type WireMsg, type WidgetState } from "@/lib/support/live-core";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";

const TOPIC_ICON: Record<PipTopicId, typeof Headset> = { analytics: BarChart3, publishing: CalendarClock, billing: CreditCard, human: Headset };
const STUDIO = ["/home", "/create", "/calendar", "/content", "/analytics", "/inbox", "/approvals", "/accounts", "/billing", "/settings", "/support"];
type Msg = {
  id: number; role: "user" | "bot"; text: string; sources?: { id: string; question: string }[]; ask?: boolean; kind?: "escalate" | "ticket" | "error" | "resolve" | "connect" | "live" | "sys"; data?: PipResult; offer?: boolean;
  // R1184 Live Assist: "connect" is Pip's offer of a person, "live" a message to or from the support team, "sys" a
  // status line. agent is the specialist's first name; sid/seq are the server's id and order; cid is our own id
  // for a message on its way (a resend carries it again, so it is never doubled).
  agent?: string; sid?: string; seq?: number; cid?: string; pending?: boolean; failed?: boolean;
};
type Snap = {
  conversationId: string; mode: string; state: CustomerState; conversationState?: string; position: number | null; messages: WireMsg[]; cursor: number; more: boolean; typing: string | null;
  session: { id: string; status: string; agent: string | null; canRate: boolean; rated: boolean } | null; receipts: { delivered: number; read: number };
  // R1205: the server's queue estimate ("1min" or none), how long it has waited, and what this person already read.
  eta?: "1min" | null; waitedMs?: number | null; readUpTo?: number; agentsOnline?: number | null;
};
type LiveInfo = { agent: string | null; position: number | null; canRate: boolean; rated: boolean; typing: string | null; receipts: { delivered: number; read: number }; eta: "1min" | null; late: boolean };
const NO_LIVE: LiveInfo = { agent: null, position: null, canRate: false, rated: false, typing: null, receipts: { delivered: 0, read: 0 }, eta: null, late: false };
/** R1205: past this, a request still waiting gets the honest update (same number as the server's ETA_MS). */
const ETA_MS = 60_000;
const LIVE_STATES: WidgetState[] = ["none", "waiting", "unavailable", "connected", "resolved", "connecting", "reconnecting"];
/** Waiting for, or talking with, a support specialist: Pip stays out of it. */
const inLive = (s: WidgetState) => s === "waiting" || s === "connected" || s === "reconnecting" || s === "connecting";
const newCid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
/** A server message as a chat line: the specialist's words, the person's own, or a status line in their language. */
function liveMsg(m: WireMsg, l: LiveT, id: number): Msg {
  const base = { id, sid: m.id, seq: m.seq ?? undefined, cid: m.cid ?? undefined };
  if (m.role === "system") return { ...base, role: "bot", text: liveSysLine(l, m.text) ?? "", kind: "sys" };
  return { ...base, role: m.role === "user" ? "user" : "bot", text: m.text, kind: "live", agent: m.role === "agent" ? m.author || "Outlly" : undefined };
}
type Card =
  | { kind: "failed"; id: string; platform: Platform; title: string; targetId: string; reconnect: boolean }
  | { kind: "reconnect"; id: string; platform: Platform }
  | { kind: "expiring"; id: string; platform: Platform; days: number };
const STORE = "outly-chat-v1";
const HIDE = ["/admin", "/billing/checkout"];
const FAILS_TO_ESCALATE = 2;
const MAX = 800;
const SLEEP_MS = 90_000;
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Pip, the support assistant (redesigned 10-15 to Apple's human-centred guidance).
 * A modal sheet: focus is trapped inside, Escape closes and focus returns to the launcher.
 * Messages live in a polite live log with "You said / Pip said" cues for screen readers.
 * Answers come from the FAQ; after two misses, or when someone asks for a person, it opens a
 * prioritised ticket. Signed-in creators also see cards for failed posts and broken connections
 * that they can fix without leaving the chat. The conversation survives page changes.
 */
export function ChatWidget({ pending }: { pending?: { q?: string } | null } = {}) {
  const path = usePathname() ?? "/";
  const inStudio = STUDIO.some((r) => path === r || path.startsWith(r + "/"));
  // Every help question is answered inside Pip (10-16): no chip or link sends you off to the help page.
  const [browse, setBrowse] = useState(false);
  const [faqList, setFaqList] = useState<{ category: string; items: { id: string; question: string }[] }[] | null>(null);
  const browseRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [me, setMe] = useState<{ name: string; email: string } | null>(null);
  const [email, setEmail] = useState("");
  const [ticket, setTicket] = useState<{ busy: boolean; error: string; ref: string }>({ busy: false, error: "", ref: "" });
  const [lift, setLift] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  // 1123: evidence-backed nudges from the person's own numbers. Only dismissed ids are stored, never the text.
  const [insights, setInsights] = useState<Insight[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  // R1189: the welcome shows four topics; one opened shows its three questions, and "More questions" the rest.
  const [topic, setTopic] = useState<PipTopicId | null>(null);
  const [allQs, setAllQs] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);
  const topicRefs = useRef<Partial<Record<PipTopicId, HTMLButtonElement | null>>>({});
  const [retrying, setRetrying] = useState<string | null>(null);
  // Editors can't re-send posts (the retry route refuses them), so the failed-post card offers no Try again for them.
  const user = useMaybeUser();
  const canRetry = user?.workspace?.role !== "editor";
  // R1194: a signed-in person anywhere (studio or marketing pages) can talk to a specialist right here.
  // R1208: Pip mounts in RootClient, outside UserProvider (studio layout only), so useMaybeUser() is null on every
  // marketing page. There the readable session hint (middleware keeps it in step with the real cookie) says who is
  // signed in. A 401 from the resume check means the hint outlived the session: the visitor path takes over.
  // Read on the first render (no false-then-true flip: a question that opens Pip goes out signed in) and again on
  // every page change, because Pip stays mounted through a client-side sign-in and the links that follow it.
  const [hinted, setHinted] = useState(hasSignedInHint);
  const [hintStale, setHintStale] = useState(false);
  useEffect(() => {
    setHinted(hasSignedInHint());
    if (inStudio) setHintStale(false); // the studio is signed in only, so a stale verdict from earlier is over
  }, [path, inStudio]);
  const signedIn = inStudio || !!user || (hinted && !hintStale);
  const [copied, setCopied] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [sleepy, setSleepy] = useState(false);
  // First run is one thing at a time: cookie choice, then the tour, then Pip.
  const [waitTurn, setWaitTurn] = useState(false);
  useEffect(() => {
    let consent = false;
    try {
      consent = !!JSON.parse(localStorage.getItem("outly-consent") ?? "null");
    } catch {}
    setWaitTurn(!consent);
    // A first-time tour starts shortly after the cookie choice: give it a beat so Pip doesn't pop in and out.
    let inTour = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const touring = () => { inTour = true; setWaitTurn(true); };
    const free = () => { inTour = false; setWaitTurn(false); };
    const afterConsent = () => { t = setTimeout(() => { if (!inTour) setWaitTurn(false); }, 1500); };
    window.addEventListener("outly:tour", touring);
    window.addEventListener("outly:tour-closed", free);
    window.addEventListener("outly:guide", touring);
    window.addEventListener("outly:guide-closed", free);
    window.addEventListener("outly:consent", afterConsent);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener("outly:tour", touring);
      window.removeEventListener("outly:tour-closed", free);
      window.removeEventListener("outly:guide", touring);
      window.removeEventListener("outly:guide-closed", free);
      window.removeEventListener("outly:consent", afterConsent);
    };
  }, []);
  const [announce, setAnnounce] = useState("");
  // 1126: the saved conversation (signed in), and whether it has been resolved (its transcript emailed).
  const [conv, setConv] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ to: string } | null>(null);
  const [closing, setClosing] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  // 1151: can a transcript really be emailed right now (email on, address verified)? Unknown = don't offer.
  const [transcriptOk, setTranscriptOk] = useState(false);
  // R1184 Live Assist: where a request for a person stands (always the server's answer), what we know about it,
  // and the last message number seen. hasLive: this conversation has had a live chat, so a reopen still arrives.
  const [live, setLive] = useState<WidgetState>("none");
  const [liveInfo, setLiveInfo] = useState<LiveInfo>(NO_LIVE);
  const [liveBusy, setLiveBusy] = useState<"" | "connect" | "cancel" | "leave" | "csat">("");
  const [liveErr, setLiveErr] = useState("");
  const [hasLive, setHasLive] = useState(false);
  // R1194: "Continue waiting" pressed: the two buttons fold away and the queue line stays.
  // R1205: is anyone from the support team online right now (the server's yes or no; null until it answers)?
  // R1205: "Leave a message" pressed with nothing typed: say where to write it.
  const [leaveHint, setLeaveHint] = useState(false);
  const [unread, setUnread] = useState(0);
  const cursorRef = useRef<number | null>(null);
  const liveRef = useRef<WidgetState>("none");
  const convRef = useRef<string | null>(null);
  const msgsRef = useRef<Msg[]>([]);
  const openRef = useRef(false);
  const pollRef = useRef<(() => Promise<void>) | null>(null);
  // R1194: the direct request ("Connect me with a support specialist" tapped on the welcome), reachable from the
  // whether "You're already in the support queue" has been said for this request.
  const alreadyRef = useRef(false);
  const resumedRef = useRef(false);
  const pollFails = useRef(0);
  const pollBusy = useRef(false);
  const typedAt = useRef(0);
  const liveDoneRef = useRef<HTMLButtonElement>(null);
  liveRef.current = live;
  convRef.current = conv;
  msgsRef.current = msgs;
  openRef.current = open;
  const closingRef = useRef(false);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const idRef = useRef(1);
  const loadedCtx = useRef(false);
  const t = T[lang];
  const cx = CX[lang];
  const rt = resolveT(lang);
  const lt = liveT(lang);

  // restore + language
  useEffect(() => {
    setLang(readLang());
    // A new visitor gets the "Questions?" note once, after they have had time to look around, and only for a
    // few seconds: a note that never leaves ends up covering the page it is meant to help with.
    let show = 0, hide = 0;
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
      if (s) {
        // A message still on its way when the page changed may not have arrived: it offers Retry (never doubled).
        setMsgs((s.msgs ?? []).map((m: Msg) => (m.pending ? { ...m, pending: false, failed: true } : m))); setFails(s.fails ?? 0); setDismissed(s.dismissed ?? []);
        if (typeof s.live === "string" && LIVE_STATES.includes(s.live)) setLive(s.live === "connecting" ? "reconnecting" : s.live === "unavailable" ? "waiting" : s.live);
        if (typeof s.cursor === "number") cursorRef.current = s.cursor;
        if (s.hasLive) setHasLive(true);
        setTicket((x) => ({ ...x, ref: s.ref ?? "" }));
        if (typeof s.conv === "string") setConv(s.conv);
        if (s.resolved && typeof s.resolved.to === "string") setResolved({ to: s.resolved.to });
        idRef.current = Math.max(0, ...(s.msgs ?? []).map((m: Msg) => m.id)) + 1;
      } else {
        show = window.setTimeout(() => {
          setNudge(true);
          hide = window.setTimeout(() => setNudge(false), 9000);
        }, 15000);
      }
    } catch {}
    const onLang = (e: Event) => setLang((e as CustomEvent<Lang>).detail);
    window.addEventListener("outly:lang", onLang);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
      window.removeEventListener("outly:lang", onLang);
    };
  }, []);
  useEffect(() => {
    // Records cards are never written to storage (1049): someone's invoices stay in memory only.
    try { sessionStorage.setItem(STORE, JSON.stringify({ msgs: msgs.slice(-40).map(({ data: _d, ...m }) => m), fails, ref: ticket.ref, dismissed, conv, resolved, live, cursor: cursorRef.current, hasLive })); } catch {}
  }, [msgs, fails, ticket.ref, dismissed, conv, resolved, live, hasLive]);
  useEffect(() => setLift(!!document.querySelector('nav[aria-label="Primary"].fixed')), [path]);

  // Follow new messages only if the reader is already at the bottom (or just sent one).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const mine = msgs[msgs.length - 1]?.role === "user";
    if (atBottom || mine) el.scrollTo({ top: el.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, busy, open]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };
  const jump = () => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); setAtBottom(true); inputRef.current?.focus(); };

  // Account cards and 1123 nudges: only for signed-in creators inside the studio, fetched once per open session.
  useEffect(() => {
    if (!open || !inStudio || loadedCtx.current) return;
    loadedCtx.current = true;
    fetch("/api/support/context").then((r) => (r.ok ? r.json() : { items: [] })).then((j) => setCards(j.items ?? [])).catch(() => {});
    fetch("/api/pip/insights").then((r) => (r.ok ? r.json() : { items: [] })).then((j) => setInsights((j.items ?? []).slice(0, 3))).catch(() => {});
    fetch("/api/support/conversation").then((r) => (r.ok ? r.json() : null)).then((j) => setTranscriptOk(!!j?.transcript?.available)).catch(() => {});
  }, [open, inStudio]);

  // Pip dozes off when nobody has typed for a while; any activity wakes it.
  useEffect(() => {
    setSleepy(false);
    if (!open) return;
    const id = setTimeout(() => setSleepy(true), SLEEP_MS);
    return () => clearTimeout(id);
  }, [open, input, msgs]);

  const push = (m: Omit<Msg, "id">) => setMsgs((x) => [...x, { ...m, id: idRef.current++ }]);

  const askEmail = useCallback(() => {
    push({ role: "bot", text: T[lang].escalate, kind: "escalate" });
    if (!me) fetch("/api/support/me").then((r) => r.json()).then((u) => { if (u) { setMe(u); setEmail((e) => e || u.email); } }).catch(() => {});
  }, [lang, me]);
  // R1184: a signed-in creator can talk to a support specialist right here. Visitors leave an email for a ticket.
  // R1194: an explicit ask for a person never comes through here: the server reads it in the message and starts the
  // handoff itself (send() above, j.handoff). This is only Pip's own doubt (two misses, the model), which offers first.
  const escalate = useCallback(() => {
    if (!signedIn) return askEmail();
    if (inLive(liveRef.current)) return;
    setMsgs((x) => x.map((m) => (m.kind === "connect" && m.offer ? { ...m, offer: false } : m)));
    push({ role: "bot", text: liveT(lang).offer, kind: "connect", offer: true });
  }, [lang, signedIn, askEmail]);

  const send = useCallback(async (text: string, faqId?: string) => {
    const q = text.trim().slice(0, MAX);
    if (!q || busy || resolved || live === "resolved") return;
    // R1184: waiting for, or talking with, a support specialist: the words go to them and Pip stays out of it.
    // While the request itself is on its way nothing is sent (the words stay in the composer).
    if (inLive(live)) return conv && live !== "connecting" ? sendLive(q) : undefined;
    setInput("");
    setNudge(false);
    const history = msgs.filter((m) => !m.kind).map((m) => ({ role: m.role, text: m.text })).slice(-8);
    // The last records card, so "and in August?" or "download them" means the same records (1049).
    const lastData = [...msgs].reverse().find((m) => m.data)?.data;
    // R1208: signedIn, not inStudio, so a handoff asked for on a marketing page is matched to its line too.
    const cid = signedIn || me ? newCid() : undefined;
    push({ role: "user", text: q, ...(cid ? { cid } : {}) });
    if (!navigator.onLine) return push({ role: "bot", text: T[lang].offline, kind: "error" });
    setBusy(true);
    try {
      const r = await fetch("/api/support/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q, history, lang, page: path.slice(0, 120), ...(faqId ? { faqId } : {}), ...(conv ? { conversationId: conv } : {}), ...(cid ? { cid } : {}), ...(lastData ? { data: { tool: lastData.ask.tool, period: lastData.ask.period, focus: lastData.ask.focus ?? null } } : {}) }) });
      const j = await r.json();
      // Resolved in another tab: lock this one too, and keep what was typed out of the log (it was never sent).
      if (r.status === 409 && j.code === "RESOLVED") { setMsgs((x) => x.slice(0, -1)); setResolved({ to: "" }); return; }
      if (!r.ok) throw Object.assign(new Error(typeof j.error === "string" ? j.error : ""), { fromServer: true });
      if (typeof j.conversationId === "string") setConv(j.conversationId);
      // R1184: the support team has this chat (picked up in another tab, or reopened): the words went to them.
      // R1194: or the words were an ask for a person, and the server put the request in the queue itself
      // (handoff "started", with the stored confirmation line in the snapshot), or found one there already.
      if (j.live) {
        const w = j.message as WireMsg | undefined;
        setMsgs((x) => x.map((m) => (cid && m.cid === cid ? { ...m, kind: "live" as const, sid: w?.id, seq: w?.seq ?? undefined } : m)));
        setHasLive(true);
        setFails(0);
        if (j.snapshot && typeof j.snapshot === "object") {
          if (j.handoff === "started") { cursorRef.current = null; alreadyRef.current = false; }
          applyLive(j.snapshot as Snap);
        } else if (!inLive(liveRef.current)) { liveRef.current = "waiting"; setLive("waiting"); }
        if (j.handoff === "already" && !alreadyRef.current && liveRef.current !== "connected") {
          alreadyRef.current = true;
          push({ role: "bot", text: liveT(lang).already, kind: "sys" });
        }
        return;
      }
      // "My issue is resolved": a compact offer to close and email the transcript. Nothing closes until they confirm.
      if (j.resolve && typeof j.conversationId === "string") {
        setMsgs((x) => x.map((m) => (m.offer ? { ...m, offer: false } : m)));
        return push({ role: "bot", text: `**${j.answer}**\n\n${resolveT(lang).ask}`, kind: "resolve", offer: true });
      }
      // Small talk ("hi", "thanks") gets a friendly reply: no "Did that help?" and it never counts as a miss.
      // sources[0] is the question just answered, so a confident reply shows only the others as Related.
      push({ role: "bot", text: j.answer, sources: (j.confident ? j.sources?.slice(1, 4) : j.sources?.slice(0, 3))?.filter((x: { id: string }) => x.id), ask: j.confident && !j.smalltalk && !j.data, data: j.data ?? undefined });
      if (j.smalltalk) return;
      if (j.wantsHuman) escalate();
      else if (!j.confident) {
        const n = fails + 1;
        setFails(n);
        if (n >= FAILS_TO_ESCALATE) escalate();
      }
    } catch (e) {
      // The server's own words when it sent any ("You've used today's AI help", "too many messages"): the
      // generic line hides the one thing that says what to do next. Anything else keeps the generic line.
      const said = e instanceof Error && (e as { fromServer?: boolean }).fromServer ? e.message.trim().slice(0, 300) : "";
      push({ role: "bot", text: said || T[lang].error, kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, resolved, conv, msgs, lang, fails, escalate, path, live, signedIn]);
  // R1194: the queue place and the chat come back in a fresh tab or after a restart: the server knows which
  // conversation this person is waiting in. Asked once per mount, only with nothing restored from this tab.
  // R1205: also a few seconds after any page loads (Pip closed), so a reply that came while this person was away
  // shows on the launcher's badge without them opening Pip first.
  useEffect(() => {
    if (!signedIn || conv || resumedRef.current) return;
    const go = () => {
      if (resumedRef.current || convRef.current) return;
      resumedRef.current = true;
      fetch("/api/support/live?resume=1", { cache: "no-store" })
        .then((r) => {
          if (r.status === 401 && !inStudio && !user) setHintStale(true);
          return r.ok ? r.json() : null;
        })
        .then((j) => {
          if (!j || typeof j.conversationId !== "string" || convRef.current) return;
          cursorRef.current = null;
          setHasLive(true);
          applyLive(j as Snap);
        })
        .catch(() => {});
    };
    if (open) { go(); return; }
    const id = window.setTimeout(go, 3_000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signedIn, conv]);

  // R1205: the one-minute estimate ends on time, even between check-ins. The end is the server's own wait count
  // (waitedMs) plus the time since that answer; the next check-in confirms it. The state itself is never guessed.
  const etaEndRef = useRef(0);
  useEffect(() => {
    if (live !== "waiting" || liveInfo.eta !== "1min" || liveInfo.late || !etaEndRef.current) return;
    const id = window.setTimeout(() => {
      setLiveInfo((i) => (i.eta === "1min" && !i.late ? { ...i, late: true } : i));
      setAnnounce(liveT(lang).waitingLong);
    }, Math.max(0, etaEndRef.current - Date.now()));
    return () => window.clearTimeout(id);
  }, [live, liveInfo.eta, liveInfo.late, lang]);

  // ---------- R1184 Live Assist, the customer side ----------
  // Every state shown comes from the server's answer (a real queue row), never from a timer in the browser.

  /** Folds one answer from /api/support/live in: state, messages (once each, in order), typing and receipts. */
  function applyLive(j: Snap) {
    if (!j || typeof j.conversationId !== "string") return;
    pollFails.current = 0;
    const prev = liveRef.current;
    // R1207: the customer is never shown "unavailable". The request is queued either way, so an answer from an
    // older server (or a cached one) is read as waiting.
    const raw: WidgetState = LIVE_STATES.includes(j.state) ? j.state : "none";
    const next: WidgetState = raw === "unavailable" ? "waiting" : raw;
    const on = next === "waiting" || next === "connected";
    if (typeof j.cursor === "number") cursorRef.current = j.cursor;
    const l = liveT(lang);
    // Pip's replies are already on screen (the chat answered them), and outside a live chat so are the person's
    // own words. A message from another tab still shows: it carries its client id.
    const incoming = (Array.isArray(j.messages) ? j.messages : []).filter((m) => m.role !== "pip" && (m.role !== "user" || on || !!m.cid));
    const known = new Set(msgsRef.current.map((m) => m.sid).filter(Boolean));
    // R1205: new words from the specialist, or the line saying one joined, that this person hasn't had on screen.
    const seenTo = typeof j.readUpTo === "number" ? j.readUpTo : 0;
    const fresh = incoming.filter((m) => !known.has(m.id) && (m.seq ?? 0) > seenTo && (m.role === "agent" || (m.role === "system" && m.text.startsWith("live.connected")))).length;
    if (incoming.length) setMsgs((x) => mergeLive(x, incoming, (m) => liveMsg(m, l, idRef.current++)).filter((m) => m.kind !== "sys" || !!m.text));
    if (fresh && !openRef.current) setUnread((n) => n + fresh);
    if (j.conversationId !== convRef.current) { convRef.current = j.conversationId; setConv(j.conversationId); }
    if (j.session) setHasLive(true);
    setLiveInfo({
      agent: j.session?.agent ?? null, position: j.position ?? null, canRate: !!j.session?.canRate, rated: !!j.session?.rated, typing: typeof j.typing === "string" ? j.typing : null, receipts: j.receipts ?? NO_LIVE.receipts,
      eta: j.eta === "1min" ? "1min" : null, late: typeof j.waitedMs === "number" && j.waitedMs >= ETA_MS,
    });
    etaEndRef.current = j.eta === "1min" && typeof j.waitedMs === "number" ? Date.now() + ETA_MS - j.waitedMs : 0;
    if (next !== prev) {
      liveRef.current = next;
      setLive(next);
      if (next !== "waiting") setLeaveHint(false);
      if (next !== "waiting") alreadyRef.current = false;
      // Waiting, connected and resolved arrive as lines in the log, and are read out from there.
      if (next === "resolved") {
        setFails(0);
        const el = document.activeElement;
        if (!el || el === document.body || el === inputRef.current) requestAnimationFrame(() => liveDoneRef.current?.focus());
      }
    }
    if (j.more) window.setTimeout(() => pollRef.current?.(), 250);
  }

  async function pollOnce() {
    const id = convRef.current;
    if (!id || pollBusy.current) return;
    pollBusy.current = true;
    try {
      const q = new URLSearchParams({ conversationId: id });
      if (cursorRef.current != null) {
        q.set("after", String(cursorRef.current));
        // What was on screen at the last check has been seen: that is "Seen" for the support team.
        if (openRef.current && !document.hidden) q.set("read", String(cursorRef.current));
      }
      const r = await fetch(`/api/support/live?${q}`, { cache: "no-store" });
      if (convRef.current !== id) return;
      // The conversation is gone (kept 90 days, or removed with the account), or the person signed out.
      if (r.status === 404 || r.status === 401) {
        cursorRef.current = null;
        liveRef.current = "none";
        setLive("none"); setHasLive(false); setLiveInfo(NO_LIVE);
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      applyLive((await r.json()) as Snap);
    } catch {
      pollFails.current += 1;
      // Two misses in a row: say so and keep trying. The next good answer puts the real state back.
      if (pollFails.current >= 2 && inLive(liveRef.current) && liveRef.current !== "reconnecting" && liveRef.current !== "connecting") {
        liveRef.current = "reconnecting";
        setLive("reconnecting");
        setAnnounce(liveT(lang).reconnecting);
      }
    } finally {
      pollBusy.current = false;
    }
  }
  pollRef.current = pollOnce;

  // Check in every 2 s in a live chat on screen, 4 s while waiting, slower with Pip closed, and never from a
  // hidden tab (it checks again the moment the tab is back). After a live chat ends, an open Pip still looks in
  // every 15 s, so a reopen from the support team arrives.
  useEffect(() => {
    if (!conv) return;
    const active = inLive(live) && live !== "connecting";
    if (!active && !(hasLive && open)) return;
    let stop = false, running = false, timer = 0;
    const every = () => (!active ? 15_000 : live === "connected" ? (open ? 2_000 : 8_000) : open ? 4_000 : 10_000);
    const tick = async () => {
      if (stop || running) return;
      running = true;
      if (!document.hidden) await pollRef.current?.();
      running = false;
      if (!stop) timer = window.setTimeout(tick, document.hidden ? 5_000 : every());
    };
    const onVis = () => { if (!document.hidden && !running) { window.clearTimeout(timer); tick(); } };
    tick();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [conv, live, open, hasLive]);
  useEffect(() => { if (open) setUnread(0); }, [open]);

  /** One message to the support team: on screen at once, saved before the server answers, resent with the same id. */
  async function sendLive(q: string, again?: Msg) {
    const id = convRef.current;
    if (!id) return;
    const cid = again?.cid ?? newCid();
    if (again) setMsgs((x) => x.map((m) => (m.cid === cid ? { ...m, pending: true, failed: false } : m)));
    else { setInput(""); push({ role: "user", text: q, kind: "live", cid, pending: true }); }
    setLiveErr("");
    typedAt.current = 0;
    try {
      const r = await fetch("/api/support/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "send", conversationId: id, text: q, cid }) });
      const j = await r.json().catch(() => ({}));
      // Back with Pip a moment ago: nothing reached the team. The words go back in the composer, and we say so.
      if (r.status === 409 && j.code === "NOT_LIVE") {
        setMsgs((x) => x.filter((m) => m.cid !== cid));
        setInput((v) => v || q);
        setLiveErr(typeof j.error === "string" ? j.error : liveT(lang).error);
        pollRef.current?.();
        return;
      }
      if (!r.ok || !j.message) throw new Error(typeof j.error === "string" ? j.error : "");
      const w = j.message as WireMsg;
      setMsgs((x) => x.map((m) => (m.cid === cid ? { ...m, sid: w.id, seq: w.seq ?? undefined, pending: false, failed: false } : m)));
      // Asked for a person again while waiting: one "You're already in the support queue", never a second request.
      if (j.handoff === "already" && !alreadyRef.current && liveRef.current !== "connected") {
        alreadyRef.current = true;
        push({ role: "bot", text: liveT(lang).already, kind: "sys" });
      }
    } catch (e) {
      setMsgs((x) => x.map((m) => (m.cid === cid ? { ...m, pending: false, failed: true } : m)));
      if (e instanceof Error && e.message) setLiveErr(e.message);
    }
  }

  /** "Typing" for the specialist, at most every 3 s and only in a connected chat. */
  function sayTyping() {
    const id = convRef.current;
    if (!id || liveRef.current !== "connected") return;
    const now = Date.now();
    if (now - typedAt.current < 3_000) return;
    typedAt.current = now;
    fetch("/api/support/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "typing", conversationId: id }) }).catch(() => {});
  }

  /**
   * A real request in the queue before anything past "Sending your request" shows. From the offer card's
   * "Connect to a human" (m is the card). Asks in words go through send() and the chat route (source "chat").
   */
  async function requestLive(source: "button", m?: Msg) {
    if (m) {
      if (!m.offer || liveBusy || busy) return;
      m.offer = false;
      setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, offer: false } : y)));
    } else if (liveBusy || inLive(liveRef.current)) return;
    const l = liveT(lang);
    setLiveErr("");
    setLiveBusy("connect");
    liveRef.current = "connecting";
    setLive("connecting");
    setAnnounce(l.connecting);
    // With no saved conversation yet, the person's last words go with the request (otherwise they are on record).
    const last = conv ? undefined : [...msgsRef.current].reverse().find((x) => x.role === "user");
    const began = Date.now();
    try {
      const r = await fetch("/api/support/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "request", source, ...(conv ? { conversationId: conv } : {}), ...(last ? { message: last.text, ...(last.cid ? { cid: last.cid } : {}) } : {}) }) });
      const j = await r.json().catch(() => ({}));
      // Signed out in another tab: say so (R1205: never an email form instead of the chat).
      if (r.status === 401) { liveRef.current = "none"; setLive("none"); push({ role: "bot", text: l.signedOut, kind: "error" }); return; }
      if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : l.error);
      // "Connecting" stays up long enough to read.
      const wait = 600 - (Date.now() - began);
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      cursorRef.current = null;
      alreadyRef.current = false;
      setHasLive(true);
      setFails(0);
      applyLive(j as Snap);
      // The request was already there (another tab, an earlier ask): said once, and no second request was made.
      if (j.created === false && (j as Snap).mode !== "human") {
        alreadyRef.current = true;
        push({ role: "bot", text: l.already, kind: "sys" });
      }
    } catch (e) {
      liveRef.current = "none";
      setLive("none");
      push({ role: "bot", text: e instanceof Error && e.message ? e.message : l.error, kind: "error" });
      // R1205: the request didn't go through. The chat stays as it was and the offer comes back to try again.
      push({ role: "bot", text: l.offer, kind: "connect", offer: true });
    } finally {
      setLiveBusy("");
    }
  }
  const connect = (m: Msg) => requestLive("button", m);
  function keepPip(m: Msg) {
    if (!m.offer) return;
    m.offer = false;
    setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, offer: false } : y)));
    push({ role: "bot", text: rt.kept });
    inputRef.current?.focus();
  }
  /** Cancel or end (back to Pip), leave a message (a ticket), or rate a resolved chat. */
  async function liveAction(action: "cancel" | "leave" | "csat", extra: Record<string, unknown> = {}) {
    const id = convRef.current;
    if (!id || liveBusy) return;
    setLiveBusy(action);
    setLiveErr("");
    try {
      const r = await fetch("/api/support/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, conversationId: id, ...extra }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : liveT(lang).error);
      if (action === "csat") {
        setLiveInfo((i) => ({ ...i, canRate: false, rated: true }));
        setAnnounce(liveT(lang).thanks);
        return;
      }
      if (action === "leave") { setInput(""); setLeaveHint(false); }
      applyLive(j as Snap);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (e) {
      setLiveErr(e instanceof Error && e.message ? e.message : liveT(lang).error);
    } finally {
      setLiveBusy("");
    }
  }

  // R1205: Leave a message never leaves the chat. With nothing typed yet it points at the composer; with words it sends them.
  function leaveHere() {
    const text = input.trim();
    if (!text) { setLeaveHint(true); requestAnimationFrame(() => inputRef.current?.focus()); return; }
    liveAction("leave", { text, cid: newCid() });
  }

  // open from anywhere: window.dispatchEvent(new CustomEvent("outly:chat-open", { detail: "optional question" }))
  useEffect(() => {
    const on = (e: Event) => {
      setOpen(true);
      const q = (e as CustomEvent<string | undefined>).detail;
      if (typeof q === "string" && q.trim()) setTimeout(() => send(q), 250);
    };
    window.addEventListener("outly:chat-open", on);
    return () => window.removeEventListener("outly:chat-open", on);
  }, [send]);

  // Someone asked for the chat before it finished loading (LazyChat): open it now.
  useEffect(() => {
    if (!pending) return;
    setOpen(true);
    if (pending.q?.trim()) setTimeout(() => send(pending.q!), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setNudge(false);
    // The launcher is hidden under the full-screen sheet on phones, so wait for it to come back.
    setTimeout(() => bubbleRef.current?.focus(), 0);
  }, []);

  // Modal behaviour: focus the composer, trap Tab inside the sheet, Escape closes, page doesn't scroll behind.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 120);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const f = [...sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      const inside = sheetRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    window.addEventListener("keydown", key);
    return () => { clearTimeout(id); window.removeEventListener("keydown", key); html.style.overflow = prev; };
  }, [open, close]);

  // Grow the composer with its content, up to about five lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input, open]);

  // The full help centre, listed inside the chat. Fetched once, then cached for the session.
  function openBrowse() {
    if (browse) return setBrowse(false);
    setBrowse(true);
    setTimeout(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); browseRef.current?.focus({ preventScroll: true }); }, 60);
    if (faqList) return;
    fetch("/api/support/faq").then((r) => (r.ok ? r.json() : { groups: [] })).then((j) => setFaqList(j.groups ?? [])).catch(() => setFaqList([]));
  }

  function feedback(m: Msg, good: boolean) {
    setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, ask: false } : y)));
    // 1126: "Yes, that helped" is the clearest "resolved" there is. Signed in with a saved chat: offer to close it.
    if (good && resolved) return;
    if (good && signedIn && conv && transcriptOk) {
      setMsgs((x) => x.map((y) => (y.offer ? { ...y, offer: false } : y)));
      return push({ role: "bot", text: `**${rt.reply}**\n\n${rt.ask}`, kind: "resolve", offer: true });
    }
    if (good) return push({ role: "bot", text: t.glad });
    const n = fails + 1;
    setFails(n);
    if (n >= FAILS_TO_ESCALATE) escalate();
    else push({ role: "bot", text: t.more });
  }

  async function raise(e: React.FormEvent) {
    e.preventDefault();
    setTicket((x) => ({ ...x, busy: true, error: "" }));
    const asked = msgs.some((m) => m.role === "user" && HUMAN_RE.test(m.text));
    try {
      const r = await fetch("/api/support/ticket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name: me?.name, reason: asked ? "asked_human" : "bot_failed", transcript: msgs.filter((m) => !m.kind).map((m) => ({ role: m.role, text: m.text.slice(0, 2000) })).slice(-40) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? t.error);
      setTicket({ busy: false, error: "", ref: j.ref });
      setMsgs((x) => x.map((m) => (m.kind === "escalate" ? { ...m, kind: undefined } : m)));
      push({ role: "bot", text: j.duplicate ? t.duplicate(j.ref) : t.raised(j.ref, j.emailed), kind: "ticket" });
      setFails(0);
    } catch (err) {
      setTicket((x) => ({ ...x, busy: false, error: navigator.onLine ? (err as Error).message : t.offline }));
    }
  }

  async function retry(c: Extract<Card, { kind: "failed" }>) {
    setRetrying(c.id);
    try {
      const r = await fetch(`/api/targets/${c.targetId}/retry`, { method: "POST" });
      if (!r.ok) throw new Error();
      setCards((x) => x.filter((y) => y.id !== c.id));
      push({ role: "bot", text: cx.retried(PLATFORM_META[c.platform].name) });
    } catch {
      push({ role: "bot", text: cx.retryFailed, kind: "error" });
    } finally {
      setRetrying(null);
    }
  }

  async function copy(m: Msg) {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(m.id);
      setAnnounce(cx.copied);
      setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1600);
    } catch {}
  }

  // 1126: close the conversation and email the transcript. One request at a time (the ref guards a double tap
  // before React re-renders); success is only shown once the server says the email went out.
  async function resolveNow() {
    if (closingRef.current || !conv) return;
    closingRef.current = true;
    setClosing({ busy: true, error: "" });
    try {
      const r = await fetch("/api/support/conversation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resolve", conversationId: conv }) });
      const j = await r.json().catch(() => ({}));
      // Gone (kept 90 days) or not theirs: a retry can never work, so say so and let the chat carry on as a new one.
      if (r.status === 404) {
        setConv(null);
        setMsgs((x) => x.map((m) => (m.offer ? { ...m, offer: false } : m)));
        setClosing({ busy: false, error: "" });
        push({ role: "bot", text: typeof j.error === "string" ? j.error : rt.failed, kind: "error" });
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      if (!r.ok || !j.ok) throw new Error(typeof j.error === "string" ? j.error : rt.failed);
      setMsgs((x) => x.map((m) => (m.offer ? { ...m, offer: false } : m)));
      setResolved({ to: typeof j.to === "string" ? j.to : "" });
      setClosing({ busy: false, error: "" });
      setAnnounce(rt.announce);
      // The offer buttons unmount; keep keyboard focus in the panel that replaces the composer.
      requestAnimationFrame(() => reopenRef.current?.focus());
    } catch (e) {
      setClosing({ busy: false, error: e instanceof Error && e.message ? e.message : rt.failed });
    } finally {
      closingRef.current = false;
    }
  }
  function keepChatting(m: Msg) {
    // 1151: one reply per press. A second tap (before React re-renders) finds the offer gone and does nothing.
    if (!m.offer || closingRef.current) return;
    m.offer = false;
    setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, offer: false } : y)));
    setClosing({ busy: false, error: "" });
    push({ role: "bot", text: rt.kept });
    inputRef.current?.focus();
  }
  async function reopenNow() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing({ busy: true, error: "" });
    try {
      if (conv) {
        const r = await fetch("/api/support/conversation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reopen", conversationId: conv }) });
        // Gone (kept 90 days) or not theirs: start a fresh conversation instead of failing.
        if (r.status === 404) setConv(null);
        else if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(typeof j.error === "string" ? j.error : T[lang].error); }
      }
      setResolved(null);
      setClosing({ busy: false, error: "" });
      push({ role: "bot", text: rt.reopened });
      setAnnounce(rt.reopened);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (e) {
      setClosing({ busy: false, error: e instanceof Error && e.message ? e.message : T[lang].error });
    } finally {
      closingRef.current = false;
    }
  }

  // 1151: "Continue in Pip" on Help centre > Your Pip conversations. Loads that saved chat as it is: a resolved
  // one stays resolved (with its Reopen button), so nothing reopens unless the person presses Reopen or writes.
  useEffect(() => {
    const on = async (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id !== "string" || !id) return;
      setOpen(true);
      try {
        const r = await fetch(`/api/support/conversation?id=${encodeURIComponent(id)}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : T[lang].error);
        // R1184: the support team's words and status lines come back as they were shown. Server ids and numbers
        // keep a live chat that is still going from showing them twice.
        const l = liveT(lang);
        type Row = { id?: string; seq?: number | null; role: string; text: string; author?: string | null };
        const list: Msg[] = (Array.isArray(j.messages) ? (j.messages as Row[]) : []).flatMap((m, i): Msg[] => {
          const base = { id: i + 1, sid: typeof m.id === "string" ? m.id : undefined, seq: typeof m.seq === "number" ? m.seq : undefined };
          if (m.role === "system") { const s = liveSysLine(l, m.text); return s ? [{ ...base, role: "bot", text: s, kind: "sys" }] : []; }
          if (m.role === "agent") return [{ ...base, role: "bot", text: m.text, kind: "live", agent: m.author || "Outlly" }];
          return [{ ...base, role: m.role === "user" ? "user" : "bot", text: m.text }];
        });
        idRef.current = list.length + 1;
        setMsgs(list); setFails(0); setInput(""); setClosing({ busy: false, error: "" });
        setConv(j.id);
        convRef.current = j.id;
        cursorRef.current = typeof j.seq === "number" ? j.seq : null;
        const was: WidgetState = j.mode === "waiting" ? "waiting" : j.mode === "human" ? "connected" : j.mode === "resolved" ? "resolved" : "none";
        liveRef.current = was;
        setLive(was); setLiveInfo(NO_LIVE); setUnread(0); setLiveErr("");
        setHasLive(was !== "none" || list.some((m) => m.kind === "sys"));
        // Resolved by the support team: their panel. Pip's own resolve (transcript emailed) keeps its own.
        setResolved(j.status === "resolved" && was !== "resolved" ? { to: typeof j.sentTo === "string" ? j.sentTo : "" } : null);
        setAnnounce(`${cx.conversation}: ${typeof j.subject === "string" ? j.subject : ""}`);
      } catch (err) {
        push({ role: "bot", text: err instanceof Error && err.message ? err.message : T[lang].error, kind: "error" });
      }
    };
    window.addEventListener("outly:pip-conversation", on);
    return () => window.removeEventListener("outly:pip-conversation", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  /** 1151: after Refresh data succeeds, ask the question behind that card again so the answer uses the fresh numbers. */
  function askAgain(m: Msg) {
    const i = msgs.findIndex((x) => x.id === m.id);
    const q = [...msgs.slice(0, i)].reverse().find((x) => x.role === "user")?.text;
    if (q) send(q);
  }

  function openTopic(id: PipTopicId) {
    setTopic(id); setAllQs(false);
    setTimeout(() => backRef.current?.focus({ preventScroll: true }), 30);
  }
  function closeTopic() {
    const was = topic;
    setTopic(null); setAllQs(false);
    setTimeout(() => { if (was) topicRefs.current[was]?.focus({ preventScroll: true }); }, 30);
  }
  // A picked question is the person's own message and Pip answers it like anything typed. "Connect me with a
  // support specialist" is read by the server as the ask it is (R1194): the request goes in the queue at once for
  // a signed-in person, and a visitor is told the email route. No offer card, no second question.
  function pick(id: PipTopicId, q: string, i: number) {
    if (busy || resolved) return;
    if (id === "human" && i === 0 && !signedIn) {
      push({ role: "user", text: q });
      return escalate();
    }
    send(q);
  }

  function newChat() {
    // An open request is ended first, so nobody on the support team waits for a chat that has moved on.
    if (conv && inLive(live)) fetch("/api/support/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", conversationId: conv }) }).catch(() => {});
    cursorRef.current = null;
    liveRef.current = "none";
    setLive("none"); setLiveInfo(NO_LIVE); setHasLive(false); setUnread(0); setLiveErr(""); alreadyRef.current = false;
    setMsgs([]); setFails(0); setTicket({ busy: false, error: "", ref: "" }); setInput("");
    setConv(null); setResolved(null); setClosing({ busy: false, error: "" });
    setTopic(null); setAllQs(false);
    try { sessionStorage.removeItem(STORE); } catch {}
    setAnnounce(cx.newChatDone);
    inputRef.current?.focus();
  }

  if (HIDE.some((h) => path.startsWith(h))) return null;
  const lastBot = [...msgs].reverse().find((m) => m.role === "bot");
  const liveOn = inLive(live);
  // Pip steps back while a person helps: a calm face, never thinking or sad.
  const mood: PipMood = resolved || live === "resolved" ? "happy" : liveOn ? (live === "connected" ? "happy" : "wait") : busy ? "think"
    : lastBot?.kind === "error" ? "dizzy"
    : lastBot?.kind === "ticket" || lastBot?.text === t.glad ? "happy"
    : lastBot?.kind === "escalate" ? "sad"
    : lastBot?.kind === "connect" && lastBot.offer ? "wave"
    : sleepy ? "sleepy"
    // Something typed: Pip looks straight at you. Empty composer: it glances around, waiting.
    : input.trim() ? "idle" : "wait";
  const waitingEmail = msgs.some((m) => m.kind === "escalate");
  const shown = cards.filter((c) => !dismissed.includes(c.id));
  const nudges = insights.filter((n) => !dismissed.includes(`insight:${n.id}`));
  const pd = PIP_DATA[lang];
  const pdx = PIP_DATA.en!;
  const home = pipHome(lang);
  const tp = topic ? home.topics.find((x) => x.id === topic) ?? null : null;
  const left = MAX - input.length;
  // Receipts sit under the person's latest message to the support team (and under any that failed).
  const lastMine = msgs.reduce((k, m, i) => (m.role === "user" && m.kind === "live" ? i : k), -1);
  const said = (r: ReturnType<typeof receipt>) => (r === "read" ? lt.seen : r === "delivered" ? lt.delivered : r === "sent" ? lt.sent : r === "failed" ? lt.failed : lt.sending);
  const returnTo = encodeURIComponent(path);

  // Create has its own writing assistant on the right, so a second bubble there only competes with it.
  // Pip still opens on request (help links fire outly:chat-open) and goes away again when closed.
  return (
    // 1154 (pc-dock): on a phone Pip steps aside with the tab bar while you scroll down, and the page gets room
    // below its last card so the bubble never sits on top of it (globals.css).
    <div data-open={open ? "" : undefined} data-lift={lift ? "" : undefined} className={cn(pipFont.variable, "pc pc-dock fixed right-4 z-[55] sm:right-6", (path.startsWith("/create") || waitTurn) && !open && "hidden", lift ? "bottom-[calc(env(safe-area-inset-bottom)+74px)] lg:bottom-6" : "bottom-[max(16px,env(safe-area-inset-bottom))] sm:bottom-6")}>
      {open && <div className="pc-scrim fixed inset-0" aria-hidden onClick={close} />}
      {open && (
        <section
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pc-title"
          aria-describedby="pc-desc"
          dir={langDir(lang)}
          lang={lang}
          data-size={big ? "lg" : "md"}
          className="pc-sheet pc-in fixed inset-0 flex flex-col overflow-hidden sm:absolute sm:inset-auto sm:bottom-[80px] sm:right-0"
        >
          <header className="pc-head flex items-center gap-3 px-3 py-2.5 sm:px-4">
            <Pip size={40} mood={mood} />
            <div className="min-w-0 flex-1">
              <h2 id="pc-title" className="truncate text-[15px] font-bold leading-tight">{t.title}</h2>
              <p id="pc-desc" className="pc-muted flex items-center gap-1.5 text-[13px]">
                {resolved || live === "resolved" ? (
                  <span className="pc-badge-resolved pc-fade inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"><Check className="h-3 w-3" aria-hidden />{rt.status}</span>
                ) : liveOn ? (
                  <><Headset className={cn("h-3.5 w-3.5 shrink-0", live === "connected" && "pc-live-ok")} aria-hidden /><span className="truncate">{live === "connected" ? (liveInfo.agent ? lt.agentLabel(liveInfo.agent) : lt.statusConnected) : live === "reconnecting" ? lt.statusReconnecting : lt.statusWaiting}</span></>
                ) : signedIn ? (
                  /* R1207: the service, not the shift. Whether a specialist is on duty is internal, and the request
                     is queued either way, so the header never says Online or Away. */
                  <span className="truncate">{lt.humanLabel}</span>
                ) : (
                  <><span className="pc-dot h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden /><span className="truncate">{t.status}</span></>
                )}
              </p>
            </div>
            {msgs.length > 0 && (
              <button type="button" onClick={newChat} aria-label={cx.newChat} title={cx.newChat} className="pc-icon"><SquarePen className="h-[18px] w-[18px]" aria-hidden /></button>
            )}
            <button type="button" onClick={() => setBig((b) => !b)} aria-pressed={big} aria-label={big ? cx.shrink : cx.expand} title={big ? cx.shrink : cx.expand} className="pc-icon max-sm:hidden">
              {big ? <Minimize2 className="h-[18px] w-[18px]" aria-hidden /> : <Maximize2 className="h-[18px] w-[18px]" aria-hidden />}
            </button>
            <button type="button" onClick={close} aria-label={t.close} title={t.close} className="pc-icon"><X className="h-5 w-5" aria-hidden /></button>
          </header>

          <div className="relative min-h-0 flex-1">
            <div ref={listRef} onScroll={onScroll} data-lenis-prevent className="h-full overflow-y-auto overscroll-contain px-4 pb-4 pt-5">
              {/* R1189: one welcome, only before the first message. After that the chat is just the conversation. */}
              {msgs.length === 0 && (<div className="pc-home">
              <div className="pc-welcome mb-4">
                <p className="pc-display text-[19px] font-extrabold">{cx.welcome} <span aria-hidden>👋</span></p>
                <p className="pc-muted mt-0.5 text-[14px] leading-snug">{home.ask}</p>
              </div>

              {!tp ? (
                <nav aria-label={home.label}>
                  <ul className="pc-topics">
                    {home.topics.map((x) => {
                      const Icon = TOPIC_ICON[x.id];
                      return (
                        <li key={x.id}>
                          <button type="button" ref={(el) => { topicRefs.current[x.id] = el; }} onClick={() => openTopic(x.id)} className="pc-row">
                            <span className="pc-row-icon" aria-hidden><Icon className="h-[18px] w-[18px]" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[14.5px] font-semibold leading-snug">{x.title}</span>
                              <span className="pc-muted block text-[12.5px] leading-snug">{x.line}</span>
                            </span>
                            <ChevronRight className="pc-muted h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              ) : (
                <section aria-labelledby="pc-topic" className="pc-topics pc-in">
                  <div className="pc-topic-head flex items-center gap-1 pe-3">
                    <button ref={backRef} type="button" onClick={closeTopic} aria-label={home.back} title={home.back} className="pc-icon"><ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden /></button>
                    <h3 id="pc-topic" className="min-w-0 truncate text-[14.5px] font-semibold">{tp.title}</h3>
                  </div>
                  {tp.id === "analytics" && !signedIn ? (
                    <div className="px-3 pb-3 pt-2.5">
                      <p className="text-[14px] leading-snug">{home.signIn}</p>
                      <Link href="/login?next=/analytics" onClick={close} className="pc-btn pc-btn-primary mt-2.5">{home.signInBtn}</Link>
                    </div>
                  ) : (<>
                    <ul>
                      {(allQs ? [...tp.questions, ...tp.more] : tp.questions).map((q, i) => (
                        <li key={q}>
                          <button type="button" disabled={busy || !!resolved} onClick={() => pick(tp.id, q, i)} className="pc-row pc-q">
                            <span className="min-w-0 flex-1">{q}</span>
                            <ArrowUp className="pc-muted h-4 w-4 shrink-0 rotate-45 rtl:-rotate-45" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                    {tp.more.length > 0 && (
                      <div className="pc-topic-foot px-3">
                        <button type="button" onClick={() => setAllQs((v) => !v)} aria-expanded={allQs} className="pc-link inline-flex min-h-11 items-center text-[13px]">{allQs ? home.fewer : `${home.more} (${tp.more.length})`}</button>
                      </div>
                    )}
                  </>)}
                </section>
              )}

              {shown.length > 0 && (
                <section aria-labelledby="pc-att" className="mt-5">
                  <h3 id="pc-att" className="pc-eyebrow mb-2">{cx.attention}</h3>
                  <ul className="space-y-2">
                    {shown.slice(0, 2).map((c) => {
                      const name = PLATFORM_META[c.platform].name;
                      const text = c.kind === "failed" ? cx.failed(name, c.title) : c.kind === "reconnect" ? cx.reconnect(name) : cx.expiring(name, c.days);
                      const needsConnect = c.kind !== "failed" || c.reconnect;
                      return (
                        <li key={c.id} className="pc-card flex items-start gap-3 p-3">
                          <PlatformOrb platform={c.platform} size={32} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] leading-snug">{text}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {c.kind === "failed" && !c.reconnect && canRetry && (
                                <button type="button" onClick={() => retry(c)} disabled={retrying === c.id} className="pc-btn pc-btn-primary">
                                  {retrying === c.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
                                  {retrying === c.id ? cx.retrying : cx.retry}
                                </button>
                              )}
                              {needsConnect && <a href={`/api/accounts/${c.platform}/connect?returnTo=${returnTo}`} className="pc-btn pc-btn-primary">{cx.reconnectBtn}</a>}
                              {c.kind === "failed" && <Link href="/content?filter=failed" onClick={close} className="pc-btn">{cx.seeAll}</Link>}
                            </div>
                          </div>
                          <button type="button" onClick={() => setDismissed((d) => [...d, c.id])} aria-label={`${cx.dismiss}: ${text}`} className="pc-icon -me-1.5 -mt-1.5"><X className="h-4 w-4" aria-hidden /></button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {nudges.length > 0 && (
                <section aria-labelledby="pc-worth" className="mt-5">
                  <h3 id="pc-worth" className="pc-eyebrow mb-2">{(pd ?? pdx).worth}</h3>
                  <ul className="space-y-2">
                    {nudges.slice(0, 1).map((n) => (
                      <li key={n.id} className={cn("pc-card pi-card flex items-start gap-3 p-3", `pi-${n.level}`)}>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-bold leading-snug">{n.title}</p>
                          <p className="mt-0.5 text-[14px] leading-snug">{n.body}</p>
                          <p className="pc-muted mt-1 text-[12px] leading-snug">{n.evidence}</p>
                          <button type="button" disabled={busy || !!resolved} onClick={() => send(n.ask)} className="pc-btn mt-2">{(pd ?? pdx).ask}</button>
                        </div>
                        <button type="button" onClick={() => setDismissed((d) => [...d, `insight:${n.id}`])} aria-label={`${cx.dismiss}: ${n.title}`} className="pc-icon -me-1.5 -mt-1.5"><X className="h-4 w-4" aria-hidden /></button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              </div>)}

              <div role="log" aria-live="polite" aria-relevant="additions" aria-label={cx.conversation} aria-busy={busy} className="space-y-3">
                {msgs.map((m, i) => m.kind === "sys" ? (
                  <p key={m.id} className="pc-sys pc-in"><Headset className="h-3.5 w-3.5 shrink-0" aria-hidden /><span>{m.text}</span></p>
                ) : (
                  <div key={m.id} className={cn("pc-in", m.role === "user" ? "pc-from-me" : "pc-from-pip")}>
                    {m.agent && msgs[i - 1]?.agent !== m.agent && <p className="pc-agent-name" aria-hidden><Headset className="h-3.5 w-3.5" />{lt.agentLabel(m.agent)}</p>}
                    <Bubble role={m.role} agent={!!m.agent} failed={m.failed} label={m.role === "user" ? cx.saidYou : m.agent ? lt.agentLabel(m.agent) : cx.saidPip} error={m.kind === "error"}>
                      {m.role === "bot" && !m.agent ? <Answer text={m.text} emphasis={!!m.data} /> : <p className="whitespace-pre-wrap">{m.text}</p>}
                    </Bubble>
                    {m.role === "user" && m.kind === "live" && (m.failed || m.pending || i === lastMine) && (
                      <p className={cn("pc-receipt", m.failed && "pc-error")}>
                        {m.failed ? (<>{lt.failed}{" "}<button type="button" onClick={() => sendLive(m.text, m)} className="pc-link inline-flex min-h-11 items-center px-1 font-semibold">{lt.retry}</button></>) : said(receipt(m, liveInfo.receipts))}
                      </p>
                    )}
                    {m.kind === "connect" && m.offer && !liveOn && (
                      <div role="group" aria-label={t.human} className="pc-offer mt-1.5 flex flex-wrap items-center gap-2 ps-1">
                        <button type="button" onClick={() => connect(m)} disabled={!!liveBusy || busy} className="pc-btn pc-btn-primary"><Headset className="h-4 w-4" aria-hidden />{lt.connect}</button>
                        <button type="button" onClick={() => keepPip(m)} disabled={!!liveBusy || busy} className="pc-btn">{lt.keepPip}</button>
                      </div>
                    )}
                    {m.data && <PipDataCard r={m.data} onRefreshed={busy || resolved ? undefined : () => askAgain(m)} />}
                    {m.role === "bot" && !m.kind && m.text !== t.glad && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 ps-1">
                        <button type="button" onClick={() => copy(m)} aria-label={copied === m.id ? cx.copied : cx.copy} title={cx.copy} className="pc-icon pc-icon-sm">
                          {copied === m.id ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                        </button>
                        {!!m.sources?.length && !m.ask && !liveOn && (
                          <>
                            <span className="pc-muted px-1 text-[12px]">{t.related}:</span>
                            {m.sources.slice(0, 3).map((s) => <button key={s.id} type="button" disabled={busy || !!resolved} onClick={() => send(s.question, s.id)} className="pc-chip pc-chip-sm text-start">{s.question}</button>)}
                          </>
                        )}
                      </div>
                    )}
                    {m.kind === "resolve" && m.offer && !resolved && !liveOn && (
                      <div className="pc-offer mt-1.5 ps-1">
                        <div role="group" aria-label={rt.reply} className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={resolveNow} disabled={closing.busy} aria-busy={closing.busy} className="pc-btn pc-btn-primary">
                            {closing.busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}{closing.busy ? rt.sending : rt.resolve}
                          </button>
                          <button type="button" onClick={() => keepChatting(m)} disabled={closing.busy} className="pc-btn">{rt.keep}</button>
                        </div>
                        {closing.error && (
                          <p role="alert" className="pc-error mt-2 text-[13px]">{closing.error}</p>
                        )}
                      </div>
                    )}
                    {m.ask && !liveOn && (
                      <div role="group" aria-label={t.helpful} className="mt-1.5 flex flex-wrap items-center gap-2 ps-1">
                        <span className="pc-muted text-[13px]" aria-hidden>{t.helpful}</span>
                        <button type="button" onClick={() => feedback(m, true)} className="pc-btn">{t.yes}</button>
                        <button type="button" onClick={() => feedback(m, false)} className="pc-btn">{t.no}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {browse && (
                <section ref={browseRef} aria-labelledby="pc-all" tabIndex={-1} className="pc-card pc-in mt-3 p-3 outline-none">
                  <div className="flex items-center justify-between gap-2">
                    <h3 id="pc-all" className="pc-eyebrow">{t.faqLink}</h3>
                    <button type="button" onClick={() => setBrowse(false)} aria-label={`${cx.dismiss}: ${t.faqLink}`} className="pc-icon pc-icon-sm -me-1"><X className="h-4 w-4" aria-hidden /></button>
                  </div>
                  {!faqList ? (
                    <p className="pc-muted mt-2 inline-flex items-center gap-2 text-[14px]"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />{t.thinking}</p>
                  ) : (
                    faqList.map((g) => (
                      <div key={g.category} className="mt-3">
                        <h4 className="pc-muted mb-1.5 text-[13px] font-semibold">{g.category}</h4>
                        <ul className="flex flex-col gap-1.5">
                          {g.items.map((q) => (
                            <li key={q.id}><button type="button" disabled={busy || !!resolved} onClick={() => { setBrowse(false); send(q.question, q.id); }} className="pc-chip w-full text-start">{q.question}</button></li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </section>
              )}

              <div role="status" aria-live="polite" className="mt-3">
                {busy && (
                  <div className="pc-bubble pc-bubble-pip inline-flex items-center gap-1.5">
                    <span className="sr-only">{t.thinking}</span>
                    {[0, 1, 2].map((i) => <span key={i} className="pc-typing h-2 w-2 rounded-full" style={{ animationDelay: `${i * 140}ms` }} aria-hidden />)}
                  </div>
                )}
                {!busy && live === "connected" && liveInfo.typing && (
                  <div className="pc-bubble pc-bubble-pip pc-bubble-agent inline-flex items-center gap-1.5">
                    <span className="sr-only">{lt.typing(liveInfo.typing)}</span>
                    {[0, 1, 2].map((i) => <span key={i} className="pc-typing h-2 w-2 rounded-full" style={{ animationDelay: `${i * 140}ms` }} aria-hidden />)}
                  </div>
                )}
              </div>

              {waitingEmail && !signedIn && !resolved && (
                <form onSubmit={raise} className="pc-card pc-in mt-3 p-3" aria-describedby="pc-email-why">
                  <label htmlFor="pc-email" className="text-[14px] font-medium">{t.email}</label>
                  <p id="pc-email-why" className="sr-only">{t.escalate}</p>
                  <div className="mt-2 flex gap-2">
                    <input id="pc-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-invalid={!!ticket.error} aria-describedby={ticket.error ? "pc-email-err" : undefined} className="pc-field h-11 min-w-0 flex-1 px-4 text-[15px]" />
                    <button type="submit" disabled={ticket.busy} className="pc-btn pc-btn-primary h-11 shrink-0">{ticket.busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}{ticket.busy ? t.raising : t.raise}</button>
                  </div>
                  {ticket.error && <p id="pc-email-err" role="alert" className="pc-error mt-2 text-[13px]">{ticket.error}</p>}
                </form>
              )}
            </div>

            {!atBottom && msgs.length > 0 && (
              <button type="button" onClick={jump} aria-label={cx.jump} title={cx.jump} className="pc-jump absolute bottom-3 left-1/2 -translate-x-1/2"><ArrowDown className="h-5 w-5" aria-hidden /></button>
            )}
          </div>

          <footer className="pc-foot px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5">
            {resolved ? (
              <div role="status" className="pc-resolved pc-in mb-1 p-3.5">
                <p className="flex items-center gap-2 text-[15px] font-semibold"><span className="pc-resolved-mark grid h-6 w-6 shrink-0 place-items-center rounded-full" aria-hidden><Check className="h-3.5 w-3.5" /></span>{rt.doneTitle}</p>
                <p className="pc-muted mt-1 text-[14px] leading-snug">{rt.doneBody(resolved.to)}</p>
                <button ref={reopenRef} type="button" onClick={reopenNow} disabled={closing.busy} className="pc-btn mt-2.5">
                  {closing.busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}{closing.busy ? rt.reopening : rt.reopen}
                </button>
                {closing.error && <p role="alert" className="pc-error mt-2 text-[13px]">{closing.error}</p>}
              </div>
            ) : live === "resolved" ? (
              <div role="status" className="pc-resolved pc-in mb-1 p-3.5">
                <p className="flex items-center gap-2 text-[15px] font-semibold"><span className="pc-resolved-mark grid h-6 w-6 shrink-0 place-items-center rounded-full" aria-hidden><Check className="h-3.5 w-3.5" /></span>{rt.status}</p>
                <p className="pc-muted mt-1 text-[14px] leading-snug">{lt.resolved}</p>
                {liveInfo.canRate ? (
                  <div role="group" aria-label={lt.helpful} className="mt-2.5 flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium" aria-hidden>{lt.helpful}</span>
                    <button type="button" onClick={() => liveAction("csat", { helpful: true })} disabled={!!liveBusy} className="pc-btn">{lt.yes}</button>
                    <button type="button" onClick={() => liveAction("csat", { helpful: false })} disabled={!!liveBusy} className="pc-btn">{lt.no}</button>
                  </div>
                ) : liveInfo.rated ? (
                  <p className="mt-2 text-[14px] font-medium">{lt.thanks}</p>
                ) : null}
                <button ref={liveDoneRef} type="button" onClick={newChat} className="pc-btn pc-btn-primary mt-2.5"><SquarePen className="h-4 w-4" aria-hidden />{lt.newChat}</button>
                {liveErr && <p role="alert" className="pc-error mt-2 text-[13px]">{liveErr}</p>}
              </div>
            ) : (<>
            {liveOn && (
              <div className={cn("pc-live pc-in mb-2 p-3", live === "connected" && "pc-live-on", live === "reconnecting" && "pc-live-warn")}>
                {/* R1207: the card leads with its own line ("You're in the support queue!", "You're connected!"), then
                    what happens next. It never mentions whether anyone is on shift. */}
                <p className="flex items-start gap-2 text-[14px] font-medium leading-snug">
                  {live === "connecting" || live === "reconnecting" ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : <Headset className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                  <span>
                    {live === "waiting" && <strong className="block font-bold">{lt.queueTitle}</strong>}
                    {live === "connected" && <strong className="block font-bold">{lt.connectedTitle}</strong>}
                    {live === "connecting" ? lt.connecting : live === "waiting" ? (liveInfo.late ? lt.waitingLong : liveInfo.eta === "1min" ? lt.waitingEta : lt.waiting) : live === "reconnecting" ? lt.reconnecting : liveInfo.agent ? lt.connectedWith(liveInfo.agent) : lt.connected}
                  </span>
                </p>
                {/* R1205: the queue status comes from the backend. The one-minute estimate shows only while a specialist is online,
                    this person is first in line and has waited under a minute; after that the honest update replaces it. */}
                {live === "waiting" && (
                  <div className="pc-muted mt-1.5 space-y-0.5 ps-6 text-[13px] leading-snug">
                    <p className="flex items-center gap-1.5">
                      <span className="pc-dot pc-pulse h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden />
                      {liveInfo.eta === "1min" && !liveInfo.late ? lt.queueConnecting : lt.queueWaiting}
                    </p>
                    {liveInfo.eta === "1min" && !liveInfo.late && <p>{lt.etaLine}</p>}
                    {!(liveInfo.eta === "1min" && !liveInfo.late) && liveInfo.position != null && <p>{lt.position(liveInfo.position)}</p>}
                  </div>
                )}
                {live !== "connecting" && (
                  <div className="mt-2 flex flex-wrap gap-2 ps-6">
                    {live === "connected" ? (
                      <button type="button" onClick={() => liveAction("cancel")} disabled={!!liveBusy} className="pc-btn">{liveBusy === "cancel" && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}{lt.endChat}</button>
                    ) : (<>
                      {/* R1207: both actions the brief asks for, from the first moment in the queue: leave a message
                          (it stays in this chat) or cancel the request (back to Pip). The request itself is untouched. */}
                      <button type="button" onClick={leaveHere} disabled={!!liveBusy} className="pc-btn">{liveBusy === "leave" && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}{liveBusy === "leave" ? lt.leaving : lt.leave}</button>
                      <button type="button" onClick={() => liveAction("cancel")} disabled={!!liveBusy} className="pc-btn">{liveBusy === "cancel" && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}{lt.cancel}</button>
                    </>)}
                  </div>
                )}
                {/* R1205: no email, no ticket. A message left here stays in this chat and the request stays in the queue. */}
                {leaveHint && live === "waiting" && <p className="pc-muted mt-2 ps-6 text-[13px] leading-snug">{lt.leaveHint}</p>}
                {liveErr && <p role="alert" className="pc-error mt-2 ps-6 text-[13px]">{liveErr}</p>}
              </div>
            )}
            {!liveOn && liveErr && <p role="alert" className="pc-error mb-1.5 px-2 text-[13px]">{liveErr}</p>}
            {!liveOn && !waitingEmail && fails > 0 && !ticket.ref && (
              <button type="button" onClick={() => escalate()} className="pc-link mb-1.5 min-h-11 text-[14px] font-medium">{t.human}</button>
            )}
            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="pc-composer flex items-end gap-2 p-1.5">
              <label htmlFor="pc-in" className="sr-only">{liveOn ? lt.placeholder : t.placeholder}</label>
              <textarea
                id="pc-in"
                ref={inputRef}
                rows={1}
                value={input}
                disabled={!!resolved}
                maxLength={MAX}
                aria-describedby="pc-hint"
                onChange={(e) => { setInput(e.target.value); sayTyping(); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }}
                placeholder={liveOn ? lt.placeholder : t.placeholder}
                className="min-h-11 flex-1 resize-none bg-transparent px-3 py-[11px] text-[16px] leading-[22px] outline-none sm:text-[15px]"
              />
              <button type="submit" disabled={!input.trim() || (busy && !liveOn) || !!resolved || live === "connecting"} aria-label={t.send} title={t.send} className="pc-send grid h-11 w-11 shrink-0 place-items-center rounded-full"><ArrowUp className="h-5 w-5" aria-hidden /></button>
            </form>
            <p id="pc-hint" className={cn("pc-muted mt-1.5 truncate px-2 text-[12px]", left > 100 && "sr-only")}>
              {left <= 100 ? <span aria-live="polite" className={cn(left <= 20 && "pc-error font-medium")}>{cx.charsLeft(left)}</span> : cx.hint}
            </p>
            </>)}
            <div className="mt-0.5 flex items-center justify-between gap-2 ps-1">
              <button type="button" onClick={openBrowse} aria-expanded={browse} className="pc-link inline-flex min-h-11 items-center text-[13px]">{t.faqLink}</button>
              <label className="pc-lang relative inline-flex h-11 shrink-0 items-center">
                <span className="sr-only">{t.lang}</span>
                <span className="pc-select pc-muted pointer-events-none inline-flex h-8 max-w-[9.5rem] items-center gap-1.5 rounded-full pe-2.5 ps-3 text-[12.5px] font-medium" aria-hidden>
                  <Globe className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{LANGS.find((l) => l.id === lang)?.label}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </span>
                <select value={lang} onChange={(e) => { const l = e.target.value as Lang; setLang(l); writeLang(l); }} title={t.lang} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
                  {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
            </div>
          </footer>
          <p className="sr-only" role="status" aria-live="polite">{announce}</p>
        </section>
      )}

      {nudge && !open && (
        <button type="button" onClick={() => { setOpen(true); setNudge(false); }} className="pc-nudge pc-in absolute bottom-[72px] right-0 min-h-11 w-max max-w-[240px] px-4 py-2.5 text-start text-[14px]">
          {t.nudge}
        </button>
      )}
      <button
        ref={bubbleRef}
        type="button"
        onClick={() => (open ? close() : (setOpen(true), setNudge(false)))}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? t.close : unread ? `${t.open}. ${lt.unread(unread)}` : t.open}
        className={cn("pc-launch relative grid h-[60px] w-[60px] place-items-center rounded-full", open && "max-sm:hidden")}
      >
        {open ? <X className="h-6 w-6" aria-hidden /> : <Pip size={46} mood={nudge ? "wave" : "idle"} />}
        {!open && unread > 0 && <span className="pc-unread" aria-hidden>{unread > 9 ? "9+" : unread}</span>}
      </button>
    </div>
  );
}

function Bubble({ role, label, error, agent, failed, children }: { role: "user" | "bot"; label: string; error?: boolean; agent?: boolean; failed?: boolean; children: React.ReactNode }) {
  return (
    // dir="auto": each message follows its own script, so Spanish punctuation stays right inside an Arabic chat.
    <div dir="auto" className={cn("pc-bubble max-w-[86%] break-words text-[15px] leading-relaxed", role === "user" ? "pc-bubble-me ms-auto" : "pc-bubble-pip", agent && "pc-bubble-agent", failed && "pc-bubble-failed", error && "pc-bubble-err")}>
      <span className="sr-only">{label}: </span>
      {children}
    </div>
  );
}
