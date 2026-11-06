"use client";
import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Camera, ChevronRight, Link2, PenLine, Plug, RefreshCw } from "lucide-react";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import { useUser } from "@/components/shell/UserContext";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META } from "@/lib/domain";
import { isProfileImg, litTicks, profileSetUp, publicLinks, viewsLabel, type CardStat, type ProfileCardView } from "@/lib/profile-card-core";
import type { CropKind } from "@/lib/profile-crop";
import { cn } from "@/lib/utils";
import { ImageCropper } from "./ImageCropper";
import { EditProfileSheet, SocialLinksSheet } from "./ProfileSheets";
import { PC } from "./motion";

const TICKS = 30;
const STAT_LABELS = { followers: "Total Followers", posts: "Posts Published", views: "Total Views" } as const;

/**
 * 1120: the creator profile card. A cover, the avatar overlapping it, name, handle, niche and bio, progress made
 * only of checkable facts, three stats added up from the connected platforms, and the public links. Every number
 * is real: a stat no connected platform reports reads "Unavailable", never a made-up value.
 */
export function CreatorProfileCard() {
  const user = useUser();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [card, setCard] = useState<ProfileCardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<null | "edit" | "links">(null);
  const [focusField, setFocusField] = useState<"name" | "bio">("name");
  const [crop, setCrop] = useState<CropKind | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const ids = useId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ card: ProfileCardView }>("/api/profile/card");
      setCard(r.card);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The card couldn't load just now.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const changed = () => {
    void load();
    router.refresh(); // the sidebar and menus show the same name and picture
  };
  const edit = (field: "name" | "bio") => (setFocusField(field), setSheet("edit"));

  const name = card?.name ?? user.name;
  const avatar = card ? card.avatar : user.avatar;
  const shown = card ? publicLinks(card.links) : [];
  const lit = card ? litTicks(card.progress, TICKS) : 0;
  const m = (x: object) => (reduce ? PC.fade : x);
  const compact = profileSetUp(card);

  return (
    <motion.section {...m(PC.card)} className="pcard relative mx-auto w-full max-w-[560px] overflow-hidden rounded-[32px]" aria-labelledby={`${ids}-name`} aria-busy={loading}>
      {/* Cover */}
      <div className="relative">
        <motion.div {...m(PC.banner)} className="pcard-banner relative aspect-[3/1] w-full overflow-hidden">
          {card?.banner ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.banner} alt="" className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden="true" className="pcard-art absolute inset-0" />
          )}
        </motion.div>
        {compact ? (
          // Set up already: two quiet icons in the cover's corner, clear of the name, avatar and stats. Same sheet,
          // same cropper, same save as the full buttons; the label is the tooltip (hover or keyboard focus).
          <div className="absolute right-2 top-2 flex gap-1.5 sm:right-3 sm:top-3" role="group" aria-label="Edit your card">
            <button type="button" onClick={() => edit("name")} className="pcard-icon-btn" aria-label="Edit profile details" data-tip="Edit details">
              <PenLine className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setCrop("banner")} className="pcard-icon-btn" aria-label="Change cover image" data-tip="Change cover">
              <Camera className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <div className="absolute right-3 top-3 flex gap-2 sm:right-4 sm:top-4">
              <button type="button" onClick={() => edit("name")} className="pcard-pill" disabled={!card}>
                <PenLine className="h-4 w-4" aria-hidden="true" /> Edit Profile
              </button>
            </div>
            <button type="button" onClick={() => setCrop("banner")} className="pcard-cover-btn absolute bottom-3 right-3 sm:right-4" disabled={!card}>
              <Camera className="h-4 w-4" aria-hidden="true" /> <span>Change Cover</span>
            </button>
          </>
        )}
      </div>

      <div className="relative px-5 pb-5 sm:px-7 sm:pb-7">
        {/* Avatar + progress */}
        <div className="flex items-end justify-between gap-4">
          <motion.div {...m(PC.avatar)} className="pcard-avatar relative -mt-12 shrink-0 sm:-mt-14">
            <OrbAvatar avatar={avatar} seed={user.email} size={112} className="pcard-avatar-img" label={`${name}'s picture`} />
            <button type="button" onClick={() => setCrop("avatar")} className="pcard-avatar-btn" aria-label="Change Picture" title="Change picture" disabled={!card}>
              <Camera className="h-4 w-4" aria-hidden="true" />
            </button>
          </motion.div>
          {card && (
            <div className="min-w-0 flex-1 pb-1 sm:max-w-[240px]">
              <button type="button" onClick={() => setShowSteps((v) => !v)} aria-expanded={showSteps} aria-controls={`${ids}-steps`} className="pcard-progress group w-full text-left">
                <span className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="font-semibold uppercase tracking-[0.08em] text-[hsl(var(--pc-muted))]">Progress</span>
                  <span className="tabular font-medium">
                    {card.progress.done} of {card.progress.total} <span className="text-[hsl(var(--pc-muted))]">· {card.progress.level}</span>
                  </span>
                </span>
                <span className="pcard-ticks mt-1.5" aria-hidden="true">
                  {Array.from({ length: TICKS }, (_, i) => (
                    <span key={i} className={cn("pcard-tick", i < lit && "is-lit")} style={{ ["--t" as string]: i / (TICKS - 1) }} />
                  ))}
                </span>
                <span className="sr-only">
                  Profile progress: {card.progress.done} of {card.progress.total} steps done. Show the steps.
                </span>
              </button>
            </div>
          )}
        </div>

        {card && showSteps && (
          <motion.ul {...m(PC.action)} id={`${ids}-steps`} className="pcard-steps mt-3 grid gap-1.5 sm:grid-cols-2" aria-label="Progress steps">
            {card.progress.steps.map((s) => (
              <li key={s.id} className={cn("flex items-center gap-2 text-[13px]", s.done ? "text-foreground" : "text-[hsl(var(--pc-muted))]")}>
                <span aria-hidden="true" className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px]", s.done ? "bg-[hsl(var(--lime))] text-[hsl(var(--lime-foreground))]" : "border border-[hsl(var(--pc-line))]")}>
                  {s.done ? "✓" : ""}
                </span>
                <span>
                  {s.label}
                  <span className="sr-only">{s.done ? ", done" : ", not yet"}</span>
                </span>
              </li>
            ))}
          </motion.ul>
        )}

        {/* Identity */}
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 id={`${ids}-name`} className="min-w-0 break-words text-[26px] font-semibold leading-tight tracking-tight">
              {name}
            </h2>
            {card?.niche && <span className="pcard-niche">{card.niche}</span>}
          </div>
          {card && (card.handle ? <p className="mt-0.5 text-[15px] text-[hsl(var(--pc-muted))]">@{card.handle}</p> : <p className="mt-0.5 text-[15px] text-[hsl(var(--pc-muted))]">No handle yet</p>)}
          {card && (
            <div className="group/bio mt-3 flex items-start gap-2">
              <p className={cn("min-w-0 flex-1 whitespace-pre-line break-words text-[15px] leading-relaxed", !card.bio && "text-[hsl(var(--pc-muted))]")}>{card.bio || "Add a short bio so people know what you make."}</p>
              <button type="button" onClick={() => edit("bio")} className="pcard-ico -mr-2 -mt-1.5" aria-label="Edit Bio">
                <PenLine className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Stats */}
        <dl className="pcard-stats mt-5 grid grid-cols-3">
          {(Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[]).map((k) => (
            <Stat key={k} label={k === "views" && card ? viewsLabel(card.stats.viewsScopes) : STAT_LABELS[k]} stat={card?.stats[k] ?? null} loading={loading && !card} id={`profile:${k}`} />
          ))}
        </dl>
        {card?.note && <p className="mt-2 text-center text-[12px] leading-snug text-[hsl(var(--pc-muted))]">{card.note}</p>}
        {card && card.connected === 0 && (
          <p className="mt-2 text-center text-[13px] text-[hsl(var(--pc-muted))]">
            Connect a platform to see your followers, posts and views here.{" "}
            <Link href="/accounts" className="font-medium text-foreground underline underline-offset-2">
              Connect one
            </Link>
          </p>
        )}

        {/* Links */}
        {shown.length > 0 && (
          <ul className="pcard-links mt-5 flex" aria-label="Social links">
            {shown.map((l) => (
              <li key={l.key} className="flex min-w-0 flex-1 justify-center">
                <a href={l.url!} target="_blank" rel="noopener noreferrer me" className="pcard-link" title={`${PLATFORM_META[l.platform].name}: ${l.label}`}>
                  <PlatformGlyph platform={l.platform} className="h-5 w-5" />
                  <span className="sr-only">
                    {PLATFORM_META[l.platform].name} {l.label} (opens in a new tab)
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="mt-4 flex items-center justify-center gap-2 text-sm text-destructive">
            {error}
            <button type="button" onClick={load} className="pcard-ico" aria-label="Try again">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
          </p>
        )}

        {/* Actions */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 border-t border-[hsl(var(--pc-line))] pt-4">
          <button type="button" onClick={() => setSheet("links")} className="pcard-action" disabled={!card}>
            <Link2 className="h-4 w-4" aria-hidden="true" /> Manage Social Links
          </button>
          <Link href="/accounts" className="pcard-action">
            <Plug className="h-4 w-4" aria-hidden="true" /> View Connected Platforms <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {card && (
        <>
          <EditProfileSheet open={sheet === "edit"} onOpenChange={(o) => setSheet(o ? "edit" : null)} card={card} focus={focusField} onSaved={changed} />
          <SocialLinksSheet open={sheet === "links"} onOpenChange={(o) => setSheet(o ? "links" : null)} card={card} onSaved={changed} />
          <ImageCropper kind={crop ?? "avatar"} open={!!crop} onOpenChange={(o) => !o && setCrop(null)} onSaved={changed} hasCurrent={crop === "banner" ? !!card.banner : isProfileImg(card.avatar, "avatar")} />
        </>
      )}
    </motion.section>
  );
}

function Stat({ label, stat, loading, id }: { label: string; stat: CardStat | null; loading: boolean; id: string }) {
  const value = stat?.value ?? null;
  return (
    <div className="pcard-stat flex min-w-0 flex-col items-center px-1 text-center">
      <dt className="order-2 mt-1 text-[12px] leading-tight text-[hsl(var(--pc-muted))] sm:text-[13px]">{label}</dt>
      <dd className="order-1 text-[22px] font-semibold leading-none tracking-tight sm:text-[26px]">
        {loading ? (
          <span className="pcard-wait inline-block h-[0.9em] w-12 rounded-md align-middle" aria-label="Loading" />
        ) : value === null ? (
          <span className="text-[15px] font-medium text-[hsl(var(--pc-muted))] sm:text-[16px]" title="No connected platform reports this yet">
            Unavailable<span className="sr-only">: no connected platform reports this yet</span>
          </span>
        ) : (
          <span title={value.toLocaleString()}>
            <AnimatedNumber value={value} format="abbr" tier="profile" id={id} />
          </span>
        )}
      </dd>
    </div>
  );
}
