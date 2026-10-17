"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CornerDownLeft, Search } from "lucide-react";
import { api } from "@/lib/client/api";
import { LETTERS_KEY, isPaletteKey, letterShortcut, rank, type Command } from "@/lib/client/commands";
import { THEME_KEY } from "@/lib/theme/script";
import { startTour } from "@/components/onboarding/Tour";
import { useToast } from "@/components/shared/Toast";
import { cn } from "@/lib/utils";
import { fmt, useUser } from "./UserContext";

export const PALETTE_EVENT = "outlly:palette";
export const openPalette = () => window.dispatchEvent(new Event(PALETTE_EVENT));

type Brief = { id: string; title: string; status: string; at: string | null };
type Item = Command & { run?: () => void };

const STATUS: Record<string, string> = { draft: "Draft", scheduled: "Scheduled", publishing: "Sending", published: "Live", partial: "Partly live", failed: "Needs a hand" };

function applyTheme(choice: "light" | "dark" | "system") {
  localStorage.setItem(THEME_KEY, choice);
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = choice;
}

/**
 * Ctrl/Cmd+K: jump anywhere, find a post, or do the common things, without the mouse.
 * N (new post) and S (plan a batch) work outside text fields and can be switched off here (WCAG 2.1.4).
 */
export function CommandPalette() {
  const router = useRouter();
  const toast = useToast();
  const user = useUser();
  const reduce = useReducedMotion();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [posts, setPosts] = useState<Brief[] | null>(null);
  const [letters, setLetters] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLetters(localStorage.getItem(LETTERS_KEY) !== "off");
  }, []);

  const go = useCallback((href: string) => {
    setOpen(false);
    router.push(href);
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteKey(e)) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      const dialogOpen = !!document.querySelector('[role="dialog"][data-state="open"], [aria-modal="true"]');
      const hit = letterShortcut(e, e.target as HTMLElement | null, { enabled: letters, dialogOpen });
      if (!hit) return;
      e.preventDefault();
      router.push(hit === "new" ? "/create" : "/create/bulk");
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
    };
  }, [letters, router]);

  // The palette wins over the onboarding tour: the tour steps aside (not marked done) so they never stack.
  useEffect(() => {
    if (open) window.dispatchEvent(new Event("outly:tour-pause"));
  }, [open]);

  // Posts load once, the first time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    if (posts) return;
    api<{ posts: Brief[] }>("/api/posts?brief=1").then((r) => setPosts(r.posts)).catch(() => setPosts([]));
  }, [open, posts]);

  const items = useMemo<Item[]>(() => {
    const own = !user.workspace;
    const nav: Item[] = [
      { id: "new", group: "Do", label: "New post", keywords: "create upload video", href: "/create", shortcut: "N" },
      { id: "batch", group: "Do", label: "Plan a batch", keywords: "schedule bulk several many week", href: "/create/bulk", shortcut: "S" },
      { id: "home", group: "Go to", label: "Home", keywords: "dashboard week", href: "/home" },
      { id: "content", group: "Go to", label: "Content", keywords: "library posts drafts", href: "/content" },
      { id: "calendar", group: "Go to", label: "Calendar", keywords: "schedule plan week", href: "/calendar" },
      { id: "analytics", group: "Go to", label: "Analytics", keywords: "views stats numbers", href: "/analytics" },
      { id: "inbox", group: "Go to", label: "Inbox", keywords: "comments messages replies", href: "/inbox" },
      { id: "approvals", group: "Go to", label: "Approvals", keywords: "review client", href: "/approvals" },
      ...(own ? [
        { id: "accounts", group: "Go to" as const, label: "Connected accounts", keywords: "instagram youtube connect reconnect", href: "/accounts" },
        { id: "billing", group: "Go to" as const, label: "Billing", keywords: "plan upgrade invoice", href: "/billing" },
      ] : []),
      { id: "settings", group: "Go to", label: "Settings", keywords: "profile timezone email", href: "/settings" },
      { id: "help", group: "Go to", label: "Help centre", keywords: "support faq", href: "/support" },
      { id: "light", group: "Do", label: "Switch to light theme", keywords: "appearance mode", run: () => applyTheme("light") },
      { id: "dark", group: "Do", label: "Switch to dark theme", keywords: "appearance mode night", run: () => applyTheme("dark") },
      { id: "system", group: "Do", label: "Match my device theme", keywords: "appearance system auto", run: () => applyTheme("system") },
      { id: "tour", group: "Do", label: "Take the tour", keywords: "help intro guide", run: () => { router.push("/home"); setTimeout(startTour, 400); } },
      {
        id: "letters", group: "Do", label: letters ? "Turn off single-key shortcuts" : "Turn on single-key shortcuts", keywords: "keyboard n s hotkeys",
        run: () => {
          const next = !letters;
          localStorage.setItem(LETTERS_KEY, next ? "on" : "off");
          setLetters(next);
          toast(next ? "N and S shortcuts are on." : "N and S shortcuts are off. Ctrl K still works.", "ok");
        },
      },
    ];
    const ps: Item[] = (posts ?? []).map((p) => ({
      id: `post-${p.id}`,
      group: "Posts",
      label: p.title,
      strict: true,
      keywords: STATUS[p.status] ?? p.status,
      hint: [STATUS[p.status] ?? p.status, p.at ? fmt(p.at, user.timezone, { month: "short", day: "numeric" }) : null].filter(Boolean).join(", "),
      href: p.status === "draft" ? `/create?post=${p.id}` : `/content?open=${p.id}`,
    }));
    return [...nav, ...ps];
  }, [user.workspace, letters, posts, router, toast]);

  // With no query, posts stay out of the way: the five most recent only.
  const shown = useMemo(() => {
    if (q.trim()) return rank(items, q, 40);
    const head = items.filter((i) => i.group !== "Posts");
    return [...head.filter((i) => i.group === "Do").slice(0, 2), ...head.filter((i) => i.group === "Go to"), ...head.filter((i) => i.group === "Do").slice(2), ...items.filter((i) => i.group === "Posts").slice(0, 5)];
  }, [items, q]);
  const groups = useMemo(() => {
    const order: Command["group"][] = q.trim() ? [] : ["Do", "Go to", "Posts"];
    const m = new Map<string, Item[]>();
    for (const g of order) m.set(g, []);
    for (const it of shown) (m.get(it.group) ?? m.set(it.group, []).get(it.group)!).push(it);
    return [...m.entries()].filter(([, v]) => v.length);
  }, [shown, q]);
  const flat = useMemo(() => groups.flatMap(([, v]) => v), [groups]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (it: Item | undefined) => {
    if (!it) return;
    if (it.href) return go(it.href);
    setOpen(false);
    it.run?.();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (flat.length ? (a + 1) % flat.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === "Home" && e.ctrlKey) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && e.ctrlKey) { e.preventDefault(); setActive(Math.max(0, flat.length - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(flat[active]); }
  };

  const optId = (i: number) => `${id}-opt-${i}`;
  let n = -1;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[90] bg-foreground/35 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.15 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <div className="fixed inset-0 z-[91] flex items-start justify-center p-4 pt-[min(14vh,120px)]" data-lenis-prevent onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 520, damping: 40 }}
                  className="glass-strong flex max-h-[min(560px,80dvh)] w-full max-w-[600px] flex-col overflow-hidden rounded-[28px]"
                >
                  <Dialog.Title className="sr-only">Search Outlly</Dialog.Title>
                  <div className="cp-search flex items-center gap-3 border-b-2 border-border/60 px-5 transition-colors focus-within:border-primary/70">
                    <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <input
                      autoFocus
                      role="combobox"
                      aria-expanded="true"
                      aria-controls={`${id}-list`}
                      aria-activedescendant={flat.length ? optId(active) : undefined}
                      aria-autocomplete="list"
                      aria-label="Search pages, actions and posts"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={onKeyDown}
                      placeholder="Search pages, actions and posts"
                      className="cp-input h-14 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground"
                    />
                    <kbd className="hidden rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hairline sm:inline">Esc</kbd>
                  </div>
                  <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Results" className="cp-list min-h-0 flex-1 overflow-y-auto p-2">
                    {groups.map(([g, list]) => (
                      <div key={g} role="group" aria-labelledby={`${id}-g-${g}`} className="mb-1">
                        <div id={`${id}-g-${g}`} role="presentation" className="eyebrow px-3 pb-1 pt-2 text-[11px]">{g}</div>
                        {list.map((it) => {
                          const i = ++n;
                          const on = i === active;
                          return (
                            <div
                              key={it.id}
                              id={optId(i)}
                              data-i={i}
                              role="option"
                              aria-selected={on}
                              onPointerMove={() => active !== i && setActive(i)}
                              onClick={() => choose(it)}
                              className={cn("flex min-h-[44px] cursor-pointer items-center gap-3 rounded-2xl px-3 text-[14.5px]", on ? "bg-secondary text-foreground" : "text-foreground/90")}
                            >
                              <span className="min-w-0 flex-1 truncate">{it.label}</span>
                              {it.hint && <span className="shrink-0 text-xs text-muted-foreground">{it.hint}</span>}
                              {it.shortcut && (
                                <>
                                  <kbd className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hairline" aria-hidden="true">{it.shortcut}</kbd>
                                  <span className="sr-only">, shortcut {it.shortcut}</span>
                                </>
                              )}
                              {on && <CornerDownLeft className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {!flat.length && (
                      <p className="px-3 py-8 text-center text-sm text-muted-foreground" role="status">
                        Nothing matches &ldquo;{q}&rdquo;.
                      </p>
                    )}
                  </div>
                  <p className="border-t border-border/60 px-5 py-2.5 text-xs text-muted-foreground">
                    Arrow keys to move, Enter to open. {letters ? "Press N for a new post or S to plan a batch, from any page." : "Single-key shortcuts are off."}
                  </p>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
