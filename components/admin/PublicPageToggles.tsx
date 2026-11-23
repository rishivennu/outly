"use client";
import { useState } from "react";
import { ExternalLink, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { PUBLIC_PAGES, pageOn, type LandingConfig, type PublicPage } from "@/lib/landing";
import { Card, CardTitle, Pill } from "./ui";
import { SwitchRow } from "./Switch";

/**
 * R1310: the public page switches (Workshops page, Resources menu link). One PUT per flip to /api/admin/landing,
 * optimistic with rollback. Shown on /admin/workshops (where the user looks for it) and on /admin/landing. Saving
 * needs the "site" area; other admins see the state read-only.
 */
export function PublicPageToggles({ initial, canEdit, only }: { initial: Pick<LandingConfig, "pages">; canEdit: boolean; only?: PublicPage[] }) {
  const toast = useToast();
  const [pages, setPages] = useState(initial.pages ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const rows = PUBLIC_PAGES.filter((p) => !only || only.includes(p.id));

  async function flip(id: PublicPage, v: boolean, label: string) {
    const prev = pages;
    setPages({ ...pages, [id]: v });
    setBusy(id);
    try {
      const r = await adminApi<{ landing: LandingConfig }>("/api/admin/landing", { method: "PUT", json: { pages: { [id]: v } } });
      setPages(r.landing.pages ?? {});
      toast(v ? `${label} is live again. Menus follow within a minute.` : `${label} is off. Visitors get a 404 or no link; menus follow within a minute.`);
    } catch (e) {
      setPages(prev);
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardTitle
        hint={canEdit ? "Each switch saves at once. Off takes the page down for visitors; the admin side keeps working." : "Only admins with site access can flip these."}
        action={
          <Button asChild variant="outline" size="sm">
            <a href={rows[0]?.path ?? "/"} target="_blank" rel="noopener noreferrer">
              Open the page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
        }
      >
        Public pages
      </CardTitle>
      <ul className="divide-y divide-border/60">
        {rows.map((p) => {
          const on = pageOn({ pages }, p.id);
          return (
            <li key={p.id} className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <SwitchRow label={p.label} hint={p.shows} on={on} disabled={!canEdit || busy === p.id} onChange={(v) => flip(p.id, v, p.label)} />
              </div>
              <Pill tone={on ? "ok" : "muted"} className="hidden shrink-0 sm:inline-flex">
                {on ? <Eye className="h-3 w-3" aria-hidden /> : <EyeOff className="h-3 w-3" aria-hidden />}
                {on ? "Live" : "Off"}
              </Pill>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
