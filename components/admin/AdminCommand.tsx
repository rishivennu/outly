"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, type LucideIcon } from "lucide-react";
import { can, type AdminArea, type AdminRole } from "@/lib/admin/perms";
import { Button } from "@/components/ui/button";
import { CommandMenu, type CommandItem } from "@/components/ui/easy/CommandMenu";

type Entry = { href: string; label: string; icon: LucideIcon; area: AdminArea; group: string };

/** The palette's entries: every admin page this role may open, in NAV order, labelled with its group. */
export function commandEntries(nav: readonly Entry[], role: AdminRole) {
  return nav.filter((n) => can(role, n.area)).map((n) => ({ id: n.href, title: n.label, category: n.group, keywords: n.href.replace(/[/-]/g, " "), icon: n.icon, href: n.href }));
}

/** Ctrl+K (Cmd+K on a Mac) or the top bar's Search opens it anywhere in the admin; Enter goes to the page. */
export function isPaletteShortcut(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">) {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

/** R1288: the admin command palette (EasyUI CommandMenu) over the same NAV the sidebar and tab bar use. */
export function AdminCommand({ nav, role }: { nav: readonly Entry[]; role: AdminRole }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items: CommandItem[] = useMemo(
    () =>
      commandEntries(nav, role).map(({ icon: Icon, href, ...e }) => ({
        ...e,
        icon: <Icon className="h-4 w-4" aria-hidden />,
        onSelect: () => {
          setOpen(false);
          router.push(href);
        },
      })),
    [nav, role, router],
  );

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts={mac ? "Meta+K" : "Control+K"} className="hidden min-h-11 gap-2 rounded-full bg-secondary/50 pl-3 pr-2 text-[13px] text-muted-foreground md:inline-flex">
        <Search className="h-4 w-4" aria-hidden />
        <span>Search</span>
        <kbd className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted-foreground">{mac ? "⌘ K" : "Ctrl K"}</kbd>
      </Button>
      <CommandMenu isOpen={open} onClose={close} items={items} placeholder="Go to an admin page" label="Admin pages" className="admin-layer z-[var(--admin-z-dialog)]" />
    </>
  );
}
