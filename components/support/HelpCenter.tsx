"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2, MessageCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Pip } from "@/components/brand/Pip";
import { Answer } from "./Answer";
import { LiquidAccordion } from "./LiquidAccordion";
import { HELP_T, readLang, type Lang } from "@/lib/i18n/support";
import { cn } from "@/lib/utils";

type Item = { id: string; category: string; q: string; a: string };
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ");
function score(it: Item, q: string) {
  const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return 1;
  const hq = norm(it.q), ha = norm(it.a);
  let s = 0;
  for (const w of words) {
    if (hq.includes(w)) s += 3;
    else if (ha.includes(w)) s += 1;
    else if (w.length > 3 && (hq.includes(w.slice(0, -1)) || ha.includes(w.slice(0, -1)))) s += 0.5; // plural / typo tail
    else return 0;
  }
  return s;
}
function Highlight({ text, q }: { text: string; q: string }) {
  const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-lime/30 px-0.5 text-foreground">{part}</mark> : part))}</>;
}

export function HelpCenter({
  items,
  categories,
  initialTopic,
  initialQuery,
  me,
  variant = "site",
  extra,
}: {
  items: Item[];
  categories: string[];
  initialTopic: string;
  initialQuery: string;
  me: { name: string; email: string } | null;
  /** "studio" sits inside the dashboard shell: left-aligned page header, no mascot, a link out to the public page. */
  variant?: "site" | "studio";
  /** Rendered between the header and the search (the dashboard puts "Your requests" there). */
  extra?: React.ReactNode;
}) {
  const [lang, setLang] = useState<Lang>("en");
  const t = HELP_T[lang];
  const [q, setQ] = useState(initialQuery);
  const [cat, setCat] = useState(initialTopic);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sugOpen, setSugOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState({ x: 0, w: 0 });

  useEffect(() => {
    setLang(readLang());
    const on = (e: Event) => setLang((e as CustomEvent<Lang>).detail);
    window.addEventListener("outly:lang", on);
    return () => window.removeEventListener("outly:lang", on);
  }, []);

  const tabs = ["", ...categories];
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-cat="${cat}"]`);
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
  }, [cat, lang]);

  const results = useMemo(
    () => items.map((it) => ({ it, s: score(it, q) })).filter((r) => r.s > 0 && (!cat || r.it.category === cat)).sort((a, b) => b.s - a.s).map((r) => r.it),
    [items, q, cat],
  );
  const suggestions = q.trim().length > 1 ? items.map((it) => ({ it, s: score(it, q) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 6).map((r) => r.it) : [];

  function pick(it: Item) {
    setSugOpen(false);
    setCat("");
    setQ("");
    setOpenId(it.id);
    requestAnimationFrame(() => document.getElementById(`faq-${it.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
  function onKey(e: React.KeyboardEvent) {
    if (!sugOpen || !suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(suggestions[active]); }
    else if (e.key === "Escape") setSugOpen(false);
  }

  const grouped = !q.trim() && !cat;
  const sections = grouped ? categories.map((c) => ({ c, list: results.filter((r) => r.category === c) })) : [{ c: "", list: results }];

  return (
    <div className={variant === "studio" ? "px-5 pb-16 pt-8 sm:px-10 lg:pt-14" : "mx-auto max-w-4xl px-5 pb-24 pt-14 sm:pt-20"}>
      {variant === "studio" ? (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-3">{t.eyebrow}</p>
            <h1 className="display max-w-3xl text-[clamp(2.4rem,5.5vw,4.2rem)]">{t.title}</h1>
          </div>
          <a href="/help" target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            Open the public help centre <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <Pip size={84} mood="wave" />
          <p className="eyebrow mt-5">{t.eyebrow}</p>
          <h1 className="display mt-2 text-[clamp(2.4rem,6vw,4.2rem)]">{t.title}</h1>
        </div>
      )}
      {extra}

      <div className="relative mx-auto mt-8 max-w-2xl">
        <Label htmlFor="help-q" className="sr-only">{t.search}</Label>
        <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          id="help-q"
          type="search"
          role="combobox"
          aria-expanded={sugOpen && suggestions.length > 0}
          aria-controls="help-sug"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `sug-${active}` : undefined}
          autoComplete="off"
          value={q}
          placeholder={t.search}
          onChange={(e) => { setQ(e.target.value); setSugOpen(true); setActive(-1); }}
          onFocus={() => setSugOpen(true)}
          onBlur={() => setTimeout(() => setSugOpen(false), 120)}
          onKeyDown={onKey}
          className="glass-strong h-16 w-full rounded-full pl-14 pr-14 text-[17px] outline-none transition-shadow focus-visible:ring-4 focus-visible:ring-lime/40 [&::-webkit-search-cancel-button]:hidden"
        />
        {q && <button type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear search" className="absolute right-4 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full hover:bg-secondary"><X className="h-4 w-4" /></button>}
        {sugOpen && suggestions.length > 0 && (
          <ul id="help-sug" role="listbox" className="glass-strong chat-pop absolute inset-x-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-[24px] p-2 text-left" style={{ transformOrigin: "top center" }}>
            {suggestions.map((s, i) => (
              <li key={s.id} id={`sug-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setActive(i)} className={cn("flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-[15px]", i === active && "bg-secondary")}>
                <span className="min-w-0 flex-1"><Highlight text={s.q} q={q} /></span>
                <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.category}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div ref={tabsRef} role="tablist" aria-label="Topics" className="relative mx-auto mt-8 flex w-max max-w-full gap-1 overflow-x-auto rounded-full bg-secondary p-1">
        <span aria-hidden className="blob-tab absolute inset-y-1 left-0 rounded-full bg-card shadow-sm" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />
        {tabs.map((c) => (
          <button key={c || "all"} data-cat={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={cn("relative z-10 h-10 shrink-0 rounded-full px-4 text-sm font-medium transition-colors", cat === c ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {c || t.all}
          </button>
        ))}
      </div>

      <div className="mt-10" aria-live="polite">
        {results.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <Pip size={64} mood="think" />
            <p className="mt-4 font-medium">{t.noMatch}</p>
            <button onClick={() => window.dispatchEvent(new CustomEvent("outly:chat-open", { detail: q }))} className="mt-3 text-sm font-medium underline underline-offset-4">{t.ask}</button>
          </div>
        ) : (
          sections.filter((s) => s.list.length).map((s) => (
            <section key={s.c || "r"} className="mb-10" aria-label={s.c || undefined}>
              {s.c && <h2 className="eyebrow mb-2">{s.c}</h2>}
              <LiquidAccordion key={`${cat}|${openId}`} defaultOpen={openId ? [openId] : []} items={s.list.map((it) => ({ id: it.id, q: it.q, a: <Answer text={it.a} /> }))} />
            </section>
          ))
        )}
      </div>

      <StillStuck me={me} t={t} />
    </div>
  );
}

function StillStuck({ me, t }: { me: { name: string; email: string } | null; t: (typeof HELP_T)["en"] }) {
  const [form, setForm] = useState(false);
  const [email, setEmail] = useState(me?.email ?? "");
  const [name, setName] = useState(me?.name ?? "");
  const [msg, setMsg] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");
  const [ref, setRef] = useState("");
  // Arriving from the "What changed" notice (?write=changes): open the form, start the message, put the cursor in it.
  useEffect(() => {
    if (new URLSearchParams(location.search).get("write") !== "changes") return;
    setForm(true);
    setMsg((m) => m || "About the recent changes: ");
    const t = window.setTimeout(() => {
      const el = document.getElementById("st-msg") as HTMLTextAreaElement | null;
      el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(el.value.length, el.value.length);
    }, 450);
    return () => window.clearTimeout(t);
  }, []);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (msg.trim().length < 10) return setErr("Tell us a little more (at least a sentence) so we can help first time.");
    setState("busy"); setErr("");
    try {
      const r = await fetch("/api/support/ticket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, name, reason: "form", transcript: [{ role: "user", text: msg.trim() }] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "We couldn't send that. Try again in a minute.");
      setRef(j.ref); setState("done");
    } catch (e2) {
      setErr(navigator.onLine ? (e2 as Error).message : "You're offline. Your message is still here; send it when you reconnect.");
      setState("idle");
    }
  }
  return (
    <section aria-labelledby="stuck" className="glass mt-6 rounded-[32px] p-6 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <Pip size={60} mood={state === "done" ? "happy" : "idle"} />
        <div className="flex-1">
          <h2 id="stuck" className="text-xl font-semibold tracking-tight">{t.stuck}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.stuckBody}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="lime" onClick={() => window.dispatchEvent(new CustomEvent("outly:chat-open"))}><MessageCircle className="h-4 w-4" aria-hidden />{t.ask}</Button>
          <Button variant="outline" aria-expanded={form} aria-controls="stuck-form" onClick={() => setForm((f) => !f)}>{t.write}</Button>
        </div>
      </div>
      <div id="stuck-form" className="liquid-panel" data-open={form}>
        <div>
          <div className="liquid-inner pt-6">
            {state === "done" ? (
              <p role="status" className="flex items-center gap-2 rounded-2xl bg-success/15 p-4 text-sm"><Check className="h-4 w-4" aria-hidden />{t.sent(ref)}</p>
            ) : (
              <form onSubmit={send} className="grid gap-4 sm:grid-cols-2" noValidate>
                <div><Label htmlFor="st-name">{t.name}</Label><Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1.5" /></div>
                <div><Label htmlFor="st-email">{t.email}</Label><Input id="st-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-1.5" /></div>
                <div className="sm:col-span-2"><Label htmlFor="st-msg">{t.message}</Label><Textarea id="st-msg" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} className="mt-1.5" maxLength={1800} /></div>
                {err && <p role="alert" className="text-sm text-destructive sm:col-span-2">{err}</p>}
                <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={state === "busy"}>{state === "busy" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{t.submit}</Button></div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
