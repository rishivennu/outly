"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Loader2, Maximize2, Minimize2, RotateCw, SquarePen, X } from "lucide-react";
import { Pip, type PipMood } from "@/components/brand/Pip";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { Answer } from "./Answer";
import { PipDataCard } from "./PipDataCard";
import type { PipResult } from "@/lib/pip/types";
import { CX, LANGS, T, langDir, readLang, writeLang, type Lang } from "@/lib/i18n/support";
import { HUMAN_RE } from "@/lib/support/smalltalk";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";

const STUDIO = ["/home", "/create", "/calendar", "/content", "/analytics", "/inbox", "/approvals", "/accounts", "/billing", "/settings", "/support"];
type Msg = { id: number; role: "user" | "bot"; text: string; sources?: { id: string; question: string }[]; ask?: boolean; kind?: "escalate" | "ticket" | "error"; data?: PipResult };
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
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
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
  const sheetRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const idRef = useRef(1);
  const loadedCtx = useRef(false);
  const t = T[lang];
  const cx = CX[lang];

  // restore + language
  useEffect(() => {
    setLang(readLang());
    // A new visitor gets the "Questions?" note once, after they have had time to look around, and only for a
    // few seconds: a note that never leaves ends up covering the page it is meant to help with.
    let show = 0, hide = 0;
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
      if (s) {
        setMsgs(s.msgs ?? []); setFails(s.fails ?? 0); setDismissed(s.dismissed ?? []);
        setTicket((x) => ({ ...x, ref: s.ref ?? "" }));
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
    try { sessionStorage.setItem(STORE, JSON.stringify({ msgs: msgs.slice(-40).map(({ data: _d, ...m }) => m), fails, ref: ticket.ref, dismissed })); } catch {}
  }, [msgs, fails, ticket.ref, dismissed]);
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

  // Account cards: only for signed-in creators inside the studio, fetched once per open session.
  useEffect(() => {
    if (!open || !inStudio || loadedCtx.current) return;
    loadedCtx.current = true;
    fetch("/api/support/context").then((r) => (r.ok ? r.json() : { items: [] })).then((j) => setCards(j.items ?? [])).catch(() => {});
  }, [open, inStudio]);

  // Pip dozes off when nobody has typed for a while; any activity wakes it.
  useEffect(() => {
    setSleepy(false);
    if (!open) return;
    const id = setTimeout(() => setSleepy(true), SLEEP_MS);
    return () => clearTimeout(id);
  }, [open, input, msgs]);

  const push = (m: Omit<Msg, "id">) => setMsgs((x) => [...x, { ...m, id: idRef.current++ }]);

  const escalate = useCallback(() => {
    push({ role: "bot", text: T[lang].escalate, kind: "escalate" });
    if (!me) fetch("/api/support/me").then((r) => r.json()).then((u) => { if (u) { setMe(u); setEmail((e) => e || u.email); } }).catch(() => {});
  }, [lang, me]);

  const send = useCallback(async (text: string, faqId?: string) => {
    const q = text.trim().slice(0, MAX);
    if (!q || busy) return;
    setInput("");
    setNudge(false);
    const history = msgs.filter((m) => !m.kind).map((m) => ({ role: m.role, text: m.text })).slice(-8);
    // The last records card, so "and in August?" or "download them" means the same records (1049).
    const lastData = [...msgs].reverse().find((m) => m.data)?.data;
    push({ role: "user", text: q });
    if (!navigator.onLine) return push({ role: "bot", text: T[lang].offline, kind: "error" });
    setBusy(true);
    try {
      const r = await fetch("/api/support/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q, history, lang, page: path.slice(0, 120), ...(faqId ? { faqId } : {}), ...(lastData ? { data: { tool: lastData.ask.tool, period: lastData.ask.period } } : {}) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
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
    } catch {
      push({ role: "bot", text: T[lang].error, kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, msgs, lang, fails, escalate, path]);

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

  function newChat() {
    setMsgs([]); setFails(0); setTicket({ busy: false, error: "", ref: "" }); setInput("");
    try { sessionStorage.removeItem(STORE); } catch {}
    setAnnounce(cx.newChatDone);
    inputRef.current?.focus();
  }

  if (HIDE.some((h) => path.startsWith(h))) return null;
  const lastBot = [...msgs].reverse().find((m) => m.role === "bot");
  const mood: PipMood = busy ? "think"
    : lastBot?.kind === "error" ? "dizzy"
    : lastBot?.kind === "ticket" || lastBot?.text === t.glad ? "happy"
    : lastBot?.kind === "escalate" ? "sad"
    : sleepy ? "sleepy"
    // Something typed: Pip looks straight at you. Empty composer: it glances around, waiting.
    : input.trim() ? "idle" : "wait";
  const waitingEmail = msgs.some((m) => m.kind === "escalate");
  const shown = cards.filter((c) => !dismissed.includes(c.id));
  const left = MAX - input.length;
  const returnTo = encodeURIComponent(path);

  // Create has its own writing assistant on the right, so a second bubble there only competes with it.
  // Pip still opens on request (help links fire outly:chat-open) and goes away again when closed.
  return (
    <div className={cn("pc fixed right-4 z-[55] sm:right-6", (path.startsWith("/create") || waitTurn) && !open && "hidden", lift ? "bottom-[96px] lg:bottom-6" : "bottom-[max(16px,env(safe-area-inset-bottom))] sm:bottom-6")}>
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
              <h2 id="pc-title" className="truncate text-[15px] font-semibold leading-tight">{t.title}</h2>
              <p id="pc-desc" className="pc-muted flex items-center gap-1.5 text-[12.5px]"><span className="pc-dot h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden /><span className="truncate">{t.status}</span></p>
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
              <div className="pc-welcome mb-5 text-center">
                <div className="mx-auto grid w-max place-items-center"><Pip size={msgs.length ? 52 : 76} mood={mood} /></div>
                <p className="mt-2 text-[19px] font-semibold tracking-tight">{cx.welcome}</p>
                <p className="pc-muted mx-auto mt-1 max-w-[34ch] text-[14px] leading-relaxed">{t.hello}</p>
              </div>

              {shown.length > 0 && (
                <section aria-labelledby="pc-att" className="mb-5">
                  <h3 id="pc-att" className="pc-eyebrow mb-2">{cx.attention}</h3>
                  <ul className="space-y-2">
                    {shown.map((c) => {
                      const name = PLATFORM_META[c.platform].name;
                      const text = c.kind === "failed" ? cx.failed(name, c.title) : c.kind === "reconnect" ? cx.reconnect(name) : cx.expiring(name, c.days);
                      const needsConnect = c.kind !== "failed" || c.reconnect;
                      return (
                        <li key={c.id} className="pc-card flex items-start gap-3 p-3">
                          <PlatformOrb platform={c.platform} size={32} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] leading-snug">{text}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {c.kind === "failed" && !c.reconnect && (
                                <button type="button" onClick={() => retry(c)} disabled={retrying === c.id} className="pc-btn pc-btn-primary">
                                  {retrying === c.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
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

              {msgs.length === 0 && (
                <section aria-labelledby="pc-pop">
                  <h3 id="pc-pop" className="pc-eyebrow mb-2">{cx.popular}</h3>
                  <ul className="flex flex-col gap-2">
                    {t.suggestions.map((s) => (
                      <li key={s}><button type="button" onClick={() => send(s)} className="pc-chip w-full text-start">{s}</button></li>
                    ))}
                  </ul>
                </section>
              )}

              <div role="log" aria-live="polite" aria-relevant="additions" aria-label={cx.conversation} aria-busy={busy} className="space-y-3">
                {msgs.map((m) => (
                  <div key={m.id} className={cn("pc-in", m.role === "user" ? "pc-from-me" : "pc-from-pip")}>
                    <Bubble role={m.role} label={m.role === "user" ? cx.saidYou : cx.saidPip} error={m.kind === "error"}>
                      {m.role === "bot" ? <Answer text={m.text} /> : <p className="whitespace-pre-wrap">{m.text}</p>}
                    </Bubble>
                    {m.data && <PipDataCard r={m.data} />}
                    {m.role === "bot" && !m.kind && m.text !== t.glad && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 ps-1">
                        <button type="button" onClick={() => copy(m)} aria-label={copied === m.id ? cx.copied : cx.copy} title={cx.copy} className="pc-icon pc-icon-sm">
                          {copied === m.id ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                        </button>
                        {!!m.sources?.length && !m.ask && (
                          <>
                            <span className="pc-muted px-1 text-[12px]">{t.related}:</span>
                            {m.sources.map((s) => <button key={s.id} type="button" disabled={busy} onClick={() => send(s.question, s.id)} className="pc-chip pc-chip-sm text-start">{s.question}</button>)}
                          </>
                        )}
                      </div>
                    )}
                    {m.ask && (
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
                    <p className="pc-muted mt-2 inline-flex items-center gap-2 text-[13.5px]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t.thinking}</p>
                  ) : (
                    faqList.map((g) => (
                      <div key={g.category} className="mt-3">
                        <h4 className="pc-muted mb-1.5 text-[12.5px] font-semibold">{g.category}</h4>
                        <ul className="flex flex-col gap-1.5">
                          {g.items.map((q) => (
                            <li key={q.id}><button type="button" disabled={busy} onClick={() => { setBrowse(false); send(q.question, q.id); }} className="pc-chip w-full text-start">{q.question}</button></li>
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
              </div>

              {waitingEmail && (
                <form onSubmit={raise} className="pc-card pc-in mt-3 p-3" aria-describedby="pc-email-why">
                  <label htmlFor="pc-email" className="text-[13.5px] font-medium">{t.email}</label>
                  <p id="pc-email-why" className="sr-only">{t.escalate}</p>
                  <div className="mt-2 flex gap-2">
                    <input id="pc-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-invalid={!!ticket.error} aria-describedby={ticket.error ? "pc-email-err" : undefined} className="pc-field h-11 min-w-0 flex-1 px-4 text-[15px]" />
                    <button type="submit" disabled={ticket.busy} className="pc-btn pc-btn-primary h-11 shrink-0">{ticket.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{ticket.busy ? t.raising : t.raise}</button>
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
            {!waitingEmail && fails > 0 && !ticket.ref && (
              <button type="button" onClick={escalate} className="pc-link mb-1.5 min-h-11 text-[13.5px] font-medium">{t.human}</button>
            )}
            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="pc-composer flex items-end gap-2 p-1.5">
              <label htmlFor="pc-in" className="sr-only">{t.placeholder}</label>
              <textarea
                id="pc-in"
                ref={inputRef}
                rows={1}
                value={input}
                maxLength={MAX}
                aria-describedby="pc-hint"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }}
                placeholder={t.placeholder}
                className="min-h-11 flex-1 resize-none bg-transparent px-3 py-[11px] text-[16px] leading-[22px] outline-none sm:text-[15px]"
              />
              <button type="submit" disabled={!input.trim() || busy} aria-label={t.send} title={t.send} className="pc-send grid h-11 w-11 shrink-0 place-items-center rounded-full"><ArrowUp className="h-5 w-5" aria-hidden /></button>
            </form>
            <p id="pc-hint" className={cn("pc-muted mt-1.5 truncate px-2 text-[12px]", left > 100 && "max-sm:sr-only")}>
              {left <= 100 ? <span aria-live="polite" className={cn(left <= 20 && "pc-error font-medium")}>{cx.charsLeft(left)}</span> : cx.hint}
            </p>
            <div className="mt-0.5 flex items-center justify-between gap-2 ps-1">
              <button type="button" onClick={openBrowse} aria-expanded={browse} className="pc-link inline-flex min-h-11 items-center text-[12.5px]">{t.faqLink}</button>
              <label className="relative shrink-0">
                <span className="sr-only">{t.lang}</span>
                <select value={lang} onChange={(e) => { const l = e.target.value as Lang; setLang(l); writeLang(l); }} title={t.lang} className="pc-select h-11 max-w-[9.5rem] cursor-pointer appearance-none truncate rounded-full py-0 pe-8 ps-4 text-[12.5px] font-medium">
                  {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
                <ChevronDown className="pc-muted pointer-events-none absolute end-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" aria-hidden />
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
        aria-label={open ? t.close : t.open}
        className={cn("pc-launch grid h-[60px] w-[60px] place-items-center rounded-full", open && "max-sm:hidden")}
      >
        {open ? <X className="h-6 w-6" aria-hidden /> : <Pip size={46} mood={nudge ? "wave" : "idle"} />}
      </button>
    </div>
  );
}

function Bubble({ role, label, error, children }: { role: "user" | "bot"; label: string; error?: boolean; children: React.ReactNode }) {
  return (
    // dir="auto": each message follows its own script, so Spanish punctuation stays right inside an Arabic chat.
    <div dir="auto" className={cn("pc-bubble max-w-[86%] break-words text-[15px] leading-relaxed", role === "user" ? "pc-bubble-me ms-auto" : "pc-bubble-pip", error && "pc-bubble-err")}>
      <span className="sr-only">{label}: </span>
      {children}
    </div>
  );
}
