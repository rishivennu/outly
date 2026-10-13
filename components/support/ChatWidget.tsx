"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const STUDIO = ["/home", "/create", "/calendar", "/content", "/analytics", "/inbox", "/approvals", "/accounts", "/billing", "/settings", "/support"];
import { ArrowUp, ChevronDown, Loader2, X } from "lucide-react";
import { Pip, type PipMood } from "@/components/brand/Pip";
import { Answer } from "./Answer";
import { LANGS, T, langDir, readLang, writeLang, type Lang } from "@/lib/i18n/support";
import { HUMAN_RE } from "@/lib/support/smalltalk";
import { cn } from "@/lib/utils";

type Msg = { id: number; role: "user" | "bot"; text: string; sources?: { id: string; question: string }[]; ask?: boolean; kind?: "escalate" | "ticket" };
const STORE = "outly-chat-v1";
const HIDE = ["/admin", "/billing/checkout"];
const FAILS_TO_ESCALATE = 2;

/**
 * Pip, the support assistant. Answers from the FAQ; after two misses (an unsure answer or a
 * "Not really"), or when someone asks for a person, it collects an email, opens a prioritised
 * ticket and the customer gets the confirmation by email. The chat survives page changes.
 */
export function ChatWidget({ pending }: { pending?: { q?: string } | null } = {}) {
  const path = usePathname();
  // Inside the dashboard, answers open the dashboard help page so you never leave the studio.
  const helpBase = STUDIO.some((r) => path === r || path?.startsWith(r + "/")) ? "/support" : "/help";
  const [open, setOpen] = useState(false);
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
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const idRef = useRef(1);
  const t = T[lang];

  // restore + language
  useEffect(() => {
    setLang(readLang());
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
      if (s) { setMsgs(s.msgs ?? []); setFails(s.fails ?? 0); setTicket((x) => ({ ...x, ref: s.ref ?? "" })); idRef.current = (s.msgs?.length ?? 0) + 1; }
      else setNudge(true);
    } catch {}
    const onLang = (e: Event) => setLang((e as CustomEvent<Lang>).detail);
    window.addEventListener("outly:lang", onLang);
    return () => window.removeEventListener("outly:lang", onLang);
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify({ msgs: msgs.slice(-40), fails, ref: ticket.ref })); } catch {}
  }, [msgs, fails, ticket.ref]);
  useEffect(() => setLift(!!document.querySelector('nav[aria-label="Primary"].fixed')), [path]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy, open]);

  const push = (m: Omit<Msg, "id">) => setMsgs((x) => [...x, { ...m, id: idRef.current++ }]);

  const escalate = useCallback(() => {
    push({ role: "bot", text: T[lang].escalate, kind: "escalate" });
    if (!me) fetch("/api/support/me").then((r) => r.json()).then((u) => { if (u) { setMe(u); setEmail((e) => e || u.email); } }).catch(() => {});
  }, [lang, me]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setNudge(false);
    const history = msgs.filter((m) => !m.kind).map((m) => ({ role: m.role, text: m.text })).slice(-8);
    push({ role: "user", text: q });
    if (!navigator.onLine) return push({ role: "bot", text: T[lang].offline });
    setBusy(true);
    try {
      const r = await fetch("/api/support/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q, history, lang }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      // Small talk ("hi", "thanks") gets a friendly reply: no "Did that help?" and it never counts as a miss.
      push({ role: "bot", text: j.answer, sources: j.sources?.slice(0, 3), ask: j.confident && !j.smalltalk });
      if (j.smalltalk) return;
      if (j.wantsHuman) escalate();
      else if (!j.confident) {
        const n = fails + 1;
        setFails(n);
        if (n >= FAILS_TO_ESCALATE) escalate();
      }
    } catch {
      push({ role: "bot", text: T[lang].error });
    } finally {
      setBusy(false);
    }
  }, [busy, msgs, lang, fails, escalate]);

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

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 120);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); bubbleRef.current?.focus(); } };
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(id); window.removeEventListener("keydown", esc); };
  }, [open]);

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

  if (HIDE.some((h) => path.startsWith(h))) return null;
  const lastBot = [...msgs].reverse().find((m) => m.role === "bot");
  const mood: PipMood = busy ? "think" : lastBot?.kind === "ticket" || lastBot?.text === t.glad ? "happy" : lastBot?.kind === "escalate" ? "sad" : "wave";
  const waitingEmail = msgs.some((m) => m.kind === "escalate");

  return (
    <div className={cn("fixed right-4 z-[55] sm:right-6", path.startsWith("/create") && "max-lg:hidden", lift ? "bottom-[96px] lg:bottom-6" : "bottom-[max(16px,env(safe-area-inset-bottom))] sm:bottom-6")}>
      {open && (
        <section role="dialog" aria-label={t.title} dir={langDir(lang)} lang={lang} className="chat-pop glass-strong absolute bottom-[76px] right-0 flex h-[min(620px,calc(100dvh-140px))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[28px] shadow-2xl">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Pip size={42} mood={mood} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight">{t.title}</p>
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />{t.status}</p>
            </div>
            <label className="relative shrink-0">
              <span className="sr-only">{t.lang}</span>
              <select
                value={lang}
                onChange={(e) => { const l = e.target.value as Lang; setLang(l); writeLang(l); }}
                title={t.lang}
                className="h-9 max-w-[9.5rem] cursor-pointer appearance-none truncate rounded-full bg-secondary py-0 pe-7 ps-3 text-[12.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-lime"
              >
                {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute end-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            </label>
            <button type="button" onClick={() => { setOpen(false); bubbleRef.current?.focus(); }} aria-label={t.close} className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"><X className="h-4 w-4" /></button>
          </div>

          <div ref={listRef} data-lenis-prevent className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
            <Bubble role="bot"><p>{t.hello}</p></Bubble>
            {msgs.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {t.suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="ripple-host rounded-full px-3 py-1.5 text-[13px] hairline transition-colors hover:bg-secondary">{s}</button>
                ))}
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className="chat-pop" style={{ transformOrigin: m.role === "user" ? "bottom right" : "bottom left" }}>
                <Bubble role={m.role}>{m.role === "bot" ? <Answer text={m.text} /> : <p className="whitespace-pre-wrap">{m.text}</p>}</Bubble>
                {m.role === "bot" && !!m.sources?.length && !m.ask && m.text !== t.glad && !m.kind && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
                    <span className="text-[11px] text-muted-foreground">{t.related}:</span>
                    {m.sources.map((s) => <Link key={s.id} href={`${helpBase}?q=${encodeURIComponent(s.question)}`} className="rounded-full px-2 py-0.5 text-[11.5px] hairline hover:bg-secondary">{s.question}</Link>)}
                  </div>
                )}
                {m.ask && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-1">
                    <span className="text-[12px] text-muted-foreground">{t.helpful}</span>
                    <button type="button" onClick={() => feedback(m, true)} className="rounded-full px-2.5 py-1 text-[12px] hairline hover:bg-secondary">{t.yes}</button>
                    <button type="button" onClick={() => feedback(m, false)} className="rounded-full px-2.5 py-1 text-[12px] hairline hover:bg-secondary">{t.no}</button>
                  </div>
                )}
              </div>
            ))}
            {busy && <Bubble role="bot"><span className="inline-flex items-center gap-1" aria-label={t.thinking}>{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 120}ms` }} />)}</span></Bubble>}
            {waitingEmail && (
              <form onSubmit={raise} className="chat-pop rounded-2xl bg-card p-3 hairline">
                <label htmlFor="chat-email" className="text-[12.5px] font-medium">{t.email}</label>
                <div className="mt-1.5 flex gap-2">
                  <input id="chat-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-10 min-w-0 flex-1 rounded-full bg-secondary px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-lime" />
                  <button type="submit" disabled={ticket.busy} className="lime-bg inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold disabled:opacity-60">{ticket.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{ticket.busy ? t.raising : t.raise}</button>
                </div>
                {ticket.error && <p role="alert" className="mt-2 text-[12.5px] text-destructive">{ticket.error}</p>}
              </form>
            )}
          </div>

          <div className="border-t border-border p-3">
            {!waitingEmail && fails > 0 && !ticket.ref && (
              <button type="button" onClick={escalate} className="mb-2 text-[12.5px] font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground">{t.human}</button>
            )}
            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2">
              <label htmlFor="chat-in" className="sr-only">{t.placeholder}</label>
              <textarea
                id="chat-in"
                ref={inputRef}
                rows={1}
                value={input}
                maxLength={800}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder={t.placeholder}
                className="max-h-28 min-h-11 flex-1 resize-none rounded-[22px] bg-secondary px-4 py-3 text-[14.5px] outline-none focus-visible:ring-2 focus-visible:ring-lime"
              />
              <button type="submit" disabled={!input.trim() || busy} aria-label={t.send} className="lime-bg grid h-11 w-11 shrink-0 place-items-center rounded-full transition-transform active:scale-95 disabled:opacity-40"><ArrowUp className="h-5 w-5" /></button>
            </form>
            <Link href={helpBase} className="mt-2 block text-center text-[11.5px] text-muted-foreground hover:text-foreground">{t.faqLink}</Link>
          </div>
        </section>
      )}

      {nudge && !open && (
        <button type="button" onClick={() => { setOpen(true); setNudge(false); }} className="chat-pop absolute bottom-[74px] right-0 w-max max-w-[240px] rounded-2xl rounded-br-md bg-card px-4 py-2.5 text-left text-[13px] shadow-lg hairline">
          {t.nudge}
        </button>
      )}
      <button
        ref={bubbleRef}
        type="button"
        onClick={() => { setOpen((o) => !o); setNudge(false); }}
        aria-expanded={open}
        aria-label={open ? t.close : t.open}
        className="lime-bg lime-glow group grid h-16 w-16 place-items-center rounded-full shadow-xl transition-transform duration-500 [transition-timing-function:var(--ease-liquid)] hover:scale-105 active:scale-95"
      >
        {open ? <X className="h-6 w-6" /> : <Pip size={48} mood={nudge ? "wave" : "idle"} />}
      </button>
    </div>
  );
}

function Bubble({ role, children }: { role: "user" | "bot"; children: React.ReactNode }) {
  return (
    // dir="auto": each message follows its own script, so Spanish punctuation stays right inside an Arabic chat.
    <div dir="auto" className={cn("max-w-[86%] break-words rounded-[20px] px-4 py-2.5 text-[14.5px] leading-relaxed", role === "user" ? "ms-auto rounded-ee-md bg-foreground text-background" : "rounded-es-md bg-card hairline")}>
      {children}
    </div>
  );
}
