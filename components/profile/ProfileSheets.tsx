"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/shared/Sheet";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORMS, PLATFORM_META, type Platform } from "@/lib/domain";
import { BIO_MAX, HANDLE_MAX, NICHE_MAX, cleanLink, handleProblem, normalizeHandle, type ProfileCardView } from "@/lib/profile-card-core";

const linkName = (p: Platform) => PLATFORM_META[p].name;

/** Name, handle, niche and bio. Saves together; a taken handle is said right under the field. */
export function EditProfileSheet({ open, onOpenChange, card, focus, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; card: ProfileCardView; focus: "name" | "bio"; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(card.name);
  const [handle, setHandle] = useState(card.handle ?? "");
  const [niche, setNiche] = useState(card.niche ?? "");
  const [bio, setBio] = useState(card.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: "handle" | "name"; text: string } | null>(null);
  const bioRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Seed from the card only as the sheet opens: a card refresh while it is open must not wipe what is typed.
  const latest = useRef(card);
  latest.current = card;
  useEffect(() => {
    if (!open) return;
    const c = latest.current;
    setName(c.name), setHandle(c.handle ?? ""), setNiche(c.niche ?? ""), setBio(c.bio ?? ""), setError(null);
    // After the sheet's entrance, so focus lands on the field that was asked for.
    const t = setTimeout(() => (focus === "bio" ? bioRef.current : nameRef.current)?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const h = normalizeHandle(handle);
  const hProblem = h ? handleProblem(h) : null;
  const dirty = name.trim() !== card.name || h !== (card.handle ?? "") || niche.trim() !== (card.niche ?? "") || bio.trim() !== (card.bio ?? "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError({ field: "name", text: "What should we call you?" });
    if (hProblem) return setError({ field: "handle", text: hProblem });
    setBusy(true);
    setError(null);
    try {
      await api("/api/settings/profile", { method: "PATCH", json: { name: name.trim(), handle: h || null, niche: niche.trim() || null, bio: bio.trim() || null } });
      toast("Profile saved.", "ok");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const text = err instanceof ApiError ? err.message : "Something got in the way.";
      setError({ field: err instanceof ApiError && err.code === "HANDLE_TAKEN" ? "handle" : undefined, text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)} title="Edit Profile" description="How you appear on your profile card.">
      <form onSubmit={save} className="grid gap-5 pt-2" noValidate>
        <div>
          <Label htmlFor="pc-name">Name</Label>
          <Input ref={nameRef} id="pc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required aria-invalid={error?.field === "name"} />
        </div>
        <div>
          <Label htmlFor="pc-handle">Handle</Label>
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
              @
            </span>
            <Input id="pc-handle" value={handle} onChange={(e) => setHandle(e.target.value.replace(/^@+/, ""))} maxLength={HANDLE_MAX + 1} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="pl-8" aria-invalid={!!hProblem || error?.field === "handle"} aria-describedby="pc-handle-d" />
          </div>
          <p id="pc-handle-d" className={hProblem || error?.field === "handle" ? "mt-2 text-xs text-destructive" : "mt-2 text-xs text-muted-foreground"}>
            {error?.field === "handle" ? error.text : hProblem ?? "Letters, numbers, dots and underscores. Leave it empty for none."}
          </p>
        </div>
        <div>
          <Label htmlFor="pc-niche">What you make (optional)</Label>
          <Input id="pc-niche" value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={NICHE_MAX} placeholder="Travel, food, tech reviews" aria-describedby="pc-niche-d" />
          <p id="pc-niche-d" className="mt-2 text-xs text-muted-foreground">Shows as a small tag next to your name.</p>
        </div>
        <div>
          <Label htmlFor="pc-bio">Bio</Label>
          <textarea
            ref={bioRef}
            id="pc-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            rows={3}
            maxLength={BIO_MAX}
            aria-describedby="pc-bio-d"
            className="w-full resize-none rounded-2xl bg-secondary/60 px-4 py-3 text-base text-foreground hairline focus-visible:outline-2"
          />
          <p id="pc-bio-d" className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>A line or two about what you make.</span>
            <span className="tabular" aria-hidden="true">
              {[...bio].length}/{BIO_MAX}
            </span>
            <span className="sr-only" aria-live="polite">
              {[...bio].length >= BIO_MAX - 20 ? `${BIO_MAX - [...bio].length} characters left` : ""}
            </span>
          </p>
        </div>
        {error && !error.field && (
          <p role="alert" className="text-sm text-destructive">
            {error.text}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty || busy || !!hProblem}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

/**
 * Which links show on the card. Connected accounts are listed with a switch; other platforms take a typed link,
 * checked to be a public profile address on that platform's own site.
 */
export function SocialLinksSheet({ open, onOpenChange, card, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; card: ProfileCardView; onSaved: () => void }) {
  const toast = useToast();
  const connected = card.links.filter((l) => l.source === "connected");
  const start = useMemo(() => {
    const added: Partial<Record<Platform, string>> = {};
    for (const l of card.links) if (l.source === "added" && l.url) added[l.platform] = l.url;
    return { hidden: card.links.filter((l) => !l.public).map((l) => l.key), added };
  }, [card]);
  const [hidden, setHidden] = useState<string[]>(start.hidden);
  const [added, setAdded] = useState<Partial<Record<Platform, string>>>(start.added);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // As above: seed on open only, so a refresh mid-edit keeps the switches and links as set.
  const latestStart = useRef(start);
  latestStart.current = start;
  useEffect(() => {
    if (open) (setHidden(latestStart.current.hidden), setAdded(latestStart.current.added), setError(null));
  }, [open]);

  const flip = (key: string, show: boolean) => setHidden((h) => (show ? h.filter((k) => k !== key) : [...new Set([...h, key])]));
  const bad = PLATFORMS.filter((p) => (added[p] ?? "").trim() && !cleanLink(p, added[p]!));

  const save = async () => {
    if (bad.length) return setError(`Check the ${bad.map(linkName).join(", ")} link: it should be your public profile address.`);
    setBusy(true);
    setError(null);
    try {
      const links = PLATFORMS.filter((p) => (added[p] ?? "").trim()).map((p) => ({ platform: p, url: added[p]!.trim() }));
      await api("/api/settings/profile", { method: "PATCH", json: { profileLinks: { hidden, links } } });
      toast("Links saved.", "ok");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something got in the way.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)} title="Manage Social Links" description="Choose what shows on your card. Only links with a public address can be opened.">
      <div className="grid gap-6 pt-2">
        <section aria-labelledby="pl-conn">
          <h3 id="pl-conn" className="eyebrow mb-2">
            Connected
          </h3>
          {connected.length === 0 ? (
            <p className="text-sm text-muted-foreground">No platforms connected yet.</p>
          ) : (
            <ul className="grid gap-2">
              {connected.map((l) => {
                const on = !hidden.includes(l.key);
                return (
                  <li key={l.key} className="flex min-h-[56px] items-center gap-3 rounded-2xl bg-secondary/50 px-3.5 py-2 hairline">
                    <PlatformGlyph platform={l.platform} className="h-5 w-5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{l.label}</span>
                      <span className="block text-xs text-muted-foreground">{l.url ? linkName(l.platform) : `${linkName(l.platform)} gives no public address for this account`}</span>
                    </span>
                    <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center">
                      <span className="sr-only">Show {linkName(l.platform)} {l.label} on my card</span>
                      <input type="checkbox" role="switch" checked={on && !!l.url} disabled={!l.url} onChange={(e) => flip(l.key, e.target.checked)} className="peer sr-only" />
                      <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-disabled:opacity-40 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-200 peer-checked:after:translate-x-5" />
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="pl-add">
          <h3 id="pl-add" className="eyebrow mb-1">
            Add a link
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">For a platform you haven&apos;t connected. Paste your public profile address.</p>
          <div className="grid gap-3">
            {PLATFORMS.filter((p) => !connected.some((c) => c.platform === p) || added[p]).map((p) => {
              const key = `link:${p}`;
              const v = added[p] ?? "";
              const wrong = bad.includes(p);
              return (
                <div key={p} className="flex items-center gap-3">
                  <PlatformGlyph platform={p} className="h-5 w-5 shrink-0" />
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{linkName(p)} profile link</span>
                    <Input value={v} onChange={(e) => setAdded((a) => ({ ...a, [p]: e.target.value }))} inputMode="url" autoCapitalize="none" spellCheck={false} placeholder={`${linkName(p)} profile link`} aria-invalid={wrong} />
                  </label>
                  {v.trim() && !wrong && (
                    <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center">
                      <span className="sr-only">Show the {linkName(p)} link on my card</span>
                      <input type="checkbox" role="switch" checked={!hidden.includes(key)} onChange={(e) => flip(key, e.target.checked)} className="peer sr-only" />
                      <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-200 peer-checked:after:translate-x-5" />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
