import {
  Plus, CloudUpload, Cog, Wand2, Scissors, Crop, RectangleVertical, Captions, Bot, Lightbulb, PenLine, Hash, Magnet,
  WandSparkles, Mic, Languages, Layers, CalendarClock, BellRing, ListOrdered, FileText, BadgeCheck, Users, MessageCircle,
  BarChart3, Eye, Heart, Trophy, Send, Share2, Target, TrendingUp, Link2, Unlink, RefreshCw, RefreshCcw, Download, Trash2,
  Settings, LifeBuoy, Check, Hourglass, TriangleAlert, PartyPopper, Shuffle, Sparkles, Images, Archive, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Outlly object set: every concept is a small, glossy, sticker-bombed 3D
 * collectible (a box, a can, a jar, a pouch, a tag or a retro computer) built in
 * CSS. Same family as the platform Collectibles on Connect accounts.
 *
 * No images: nothing to download, crisp at any size, themable, and cheap to paint
 * (gradients only, no filters, no 3D transforms, so dozens on a page cost nothing).
 * Everything is in em and 1em = a tenth of the rendered width (container query),
 * so a className like "h-14 w-14" scales the whole object, stickers included.
 */
export const ICONS = [
  "create", "upload", "processing", "auto-format", "edit-clip", "smart-crop", "aspect-ratios", "auto-subtitles",
  "ai-assistant", "generate-ideas", "write-captions", "hashtags", "hook-generator", "improve-copy", "voice-audio", "translate",
  "platforms", "schedule", "reminders", "content-queue", "drafts", "approval", "collaboration", "comments",
  "analytics", "views", "engagement", "milestones", "publish", "distribute", "reach-goals", "growth",
  "connected", "disconnected", "reconnect", "sync", "download", "delete", "settings", "support",
  "success", "loading", "error", "celebration", "try-another", "inspiration", "gallery", "archive",
] as const;
export type IconName = (typeof ICONS)[number];

type Shape = "box" | "can" | "jar" | "pouch" | "tag" | "device";
type Tone = "lime" | "purple" | "pink" | "orange" | "blue" | "red" | "teal" | "yellow" | "green" | "black" | "gray" | "cream";

/** a = highlight, b = body, c = shade, ink = glyph colour on the body */
const TONES: Record<Tone, { a: string; b: string; c: string; ink: string }> = {
  lime: { a: "#efff8a", b: "#c2f415", c: "#6c9200", ink: "#10140a" },
  purple: { a: "#d4b8ff", b: "#8b4dff", c: "#3f1a9c", ink: "#ffffff" },
  pink: { a: "#ffc2df", b: "#ff4f9a", c: "#a0124f", ink: "#ffffff" },
  orange: { a: "#ffd0a0", b: "#ff7a1a", c: "#a84000", ink: "#ffffff" },
  blue: { a: "#b5dcff", b: "#2f7bff", c: "#0d348f", ink: "#ffffff" },
  red: { a: "#ffaaa2", b: "#f0302a", c: "#850c08", ink: "#ffffff" },
  teal: { a: "#b2fbee", b: "#14c9a6", c: "#066552", ink: "#04231d" },
  yellow: { a: "#fff6b0", b: "#ffd21f", c: "#a87f00", ink: "#2a2000" },
  green: { a: "#c4f9d0", b: "#2ed36a", c: "#0d6d33", ink: "#052812" },
  black: { a: "#77777f", b: "#2a2a30", c: "#09090b", ink: "#f4f4f4" },
  gray: { a: "#f1f1f4", b: "#b4b4be", c: "#5a5a66", ink: "#15151a" },
  cream: { a: "#fffdf6", b: "#f1e4c6", c: "#b09a6c", ink: "#2a2010" },
};

const SPEC: Record<IconName, [Shape, Tone, LucideIcon, string]> = {
  create: ["device", "lime", Plus, "MAKE"],
  upload: ["box", "blue", CloudUpload, "UPLOAD"],
  processing: ["can", "orange", Cog, "PROC"],
  "auto-format": ["box", "purple", Wand2, "FORMAT"],
  "edit-clip": ["tag", "pink", Scissors, "CUT"],
  "smart-crop": ["jar", "teal", Crop, "CROP"],
  "aspect-ratios": ["box", "yellow", RectangleVertical, "9:16"],
  "auto-subtitles": ["can", "black", Captions, "SUBS"],
  "ai-assistant": ["device", "purple", Bot, "AI"],
  "generate-ideas": ["jar", "yellow", Lightbulb, "IDEAS"],
  "write-captions": ["pouch", "pink", PenLine, "COPY"],
  hashtags: ["tag", "lime", Hash, "TAGS"],
  "hook-generator": ["can", "red", Magnet, "HOOK"],
  "improve-copy": ["pouch", "teal", WandSparkles, "POLISH"],
  "voice-audio": ["device", "orange", Mic, "VOICE"],
  translate: ["box", "blue", Languages, "LANG"],
  platforms: ["box", "black", Layers, "3 IN 1"],
  schedule: ["jar", "orange", CalendarClock, "LATER"],
  reminders: ["can", "yellow", BellRing, "PING"],
  "content-queue": ["box", "purple", ListOrdered, "QUEUE"],
  drafts: ["pouch", "cream", FileText, "DRAFT"],
  approval: ["tag", "green", BadgeCheck, "OK"],
  collaboration: ["jar", "pink", Users, "TEAM"],
  comments: ["can", "blue", MessageCircle, "REPLY"],
  analytics: ["device", "teal", BarChart3, "STATS"],
  views: ["can", "purple", Eye, "VIEWS"],
  engagement: ["pouch", "red", Heart, "LOVE"],
  milestones: ["tag", "yellow", Trophy, "WIN"],
  publish: ["box", "lime", Send, "SHIP IT"],
  distribute: ["can", "lime", Share2, "SPREAD"],
  "reach-goals": ["jar", "red", Target, "GOAL"],
  growth: ["pouch", "green", TrendingUp, "GROW"],
  connected: ["tag", "green", Link2, "LIVE"],
  disconnected: ["tag", "gray", Unlink, "OFF"],
  reconnect: ["can", "yellow", RefreshCw, "RETRY"],
  sync: ["jar", "blue", RefreshCcw, "SYNC"],
  download: ["box", "teal", Download, "SAVE"],
  delete: ["can", "red", Trash2, "TOSS"],
  settings: ["device", "gray", Settings, "TUNE"],
  support: ["jar", "purple", LifeBuoy, "HELP"],
  success: ["tag", "green", Check, "DONE"],
  loading: ["can", "blue", Hourglass, "WAIT"],
  error: ["box", "red", TriangleAlert, "OOPS"],
  celebration: ["pouch", "pink", PartyPopper, "YAY"],
  "try-another": ["tag", "orange", Shuffle, "AGAIN"],
  inspiration: ["jar", "yellow", Sparkles, "SPARK"],
  gallery: ["box", "pink", Images, "LIB"],
  archive: ["box", "cream", Archive, "VAULT"],
};

/** Sticker colours that read on any body; picked so the sticker never matches the body. */
const STICKERS = ["#fff36b", "#ffffff", "#c2f415", "#ff8fc4", "#8ff0ff"];

const gloss = "linear-gradient(118deg,rgba(255,255,255,.55) 0%,rgba(255,255,255,.14) 20%,transparent 38%,transparent 72%,rgba(255,255,255,.1) 100%)";

function Glyph({ Icon, ink, className }: { Icon: LucideIcon; ink: string; className?: string }) {
  return <Icon className={cn("o3d-glyph", className)} style={{ color: ink }} strokeWidth={2.5} aria-hidden="true" />;
}

function Body({ shape, t, Icon }: { shape: Shape; t: (typeof TONES)[Tone]; Icon: LucideIcon }) {
  switch (shape) {
    case "box":
      return (
        <>
          <span className="o3d-p left-[1.3em] top-[1.75em] h-[1.4em] w-[6em] origin-bottom-left skew-x-[-45deg] rounded-[.3em]" style={{ background: `linear-gradient(90deg,${t.a},${t.b})` }} />
          <span className="o3d-p left-[7.3em] top-[3.15em] h-[5.4em] w-[1.4em] origin-top-left skew-y-[-45deg] rounded-[.3em]" style={{ background: `linear-gradient(180deg,${t.c},${t.c}dd)` }} />
          <span className="o3d-p o3d-face left-[1.3em] top-[3.15em] h-[5.4em] w-[6em] rounded-[.45em]" style={{ background: `linear-gradient(160deg,${t.b} 0%,${t.b} 45%,${t.c} 130%)` }}>
            <span className="o3d-fill" style={{ background: gloss }} />
            <Glyph Icon={Icon} ink={t.ink} className="left-1/2 top-[45%] h-[2.7em] w-[2.7em] -translate-x-1/2 -translate-y-1/2" />
          </span>
        </>
      );
    case "can":
      return (
        <>
          <span className="o3d-p o3d-face left-[2.2em] top-[1.9em] h-[6.9em] w-[5.6em] rounded-b-[2.8em_.7em] rounded-t-[.3em]" style={{ background: `linear-gradient(90deg,${t.c} 0%,${t.b} 16%,${t.a} 34%,${t.b} 56%,${t.c} 100%)` }}>
            <span className="o3d-fill top-[22%] h-[56%] bg-black/10" />
            <Glyph Icon={Icon} ink={t.ink} className="left-1/2 top-1/2 h-[2.5em] w-[2.5em] -translate-x-1/2 -translate-y-1/2" />
          </span>
          <span className="o3d-p left-[2.2em] top-[1.2em] h-[1.4em] w-[5.6em] rounded-[50%]" style={{ background: "linear-gradient(180deg,#f4f4f7,#8d8d96)" }}>
            <span className="o3d-fill m-[.22em_.3em] rounded-[50%]" style={{ background: "linear-gradient(180deg,#a8a8b0,#d8d8de)" }} />
            <span className="o3d-p left-[2.1em] top-[.3em] h-[.55em] w-[1.4em] rounded-full border-[.12em] border-[#77777f]" />
          </span>
        </>
      );
    case "jar":
      return (
        <>
          <span className="o3d-p o3d-face left-[1.7em] top-[2.6em] h-[6.3em] w-[6.6em] rounded-[1.7em]" style={{ background: `radial-gradient(120% 90% at 30% 20%,${t.a} 0%,${t.b} 45%,${t.c} 120%)` }}>
            <span className="o3d-fill" style={{ background: gloss }} />
            <span className="o3d-p left-1/2 top-[52%] grid h-[3.6em] w-[4.4em] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[.7em] bg-white shadow-[inset_0_-.15em_0_rgba(0,0,0,.08)]">
              <Icon className="h-[2.3em] w-[2.3em]" style={{ color: t.c }} strokeWidth={2.6} aria-hidden="true" />
            </span>
          </span>
          <span className="o3d-p left-[2.3em] top-[1.3em] h-[1.7em] w-[5.4em] rounded-[.5em]" style={{ background: `repeating-linear-gradient(90deg,#1b1b20 0 .28em,#3a3a42 .28em .56em)` }}>
            <span className="o3d-fill rounded-[.5em]" style={{ background: "linear-gradient(180deg,rgba(255,255,255,.35),transparent 50%,rgba(0,0,0,.35))" }} />
          </span>
        </>
      );
    case "pouch":
      return (
        <span className="o3d-p o3d-face left-[1.9em] top-[1.4em] h-[7.6em] w-[6.2em] rounded-[.5em_.5em_1.2em_1.2em] [clip-path:polygon(7%_0,93%_0,100%_100%,0_100%)]" style={{ background: `linear-gradient(150deg,${t.a} -10%,${t.b} 40%,${t.c} 115%)` }}>
          <span className="o3d-fill h-[.9em]" style={{ background: `repeating-linear-gradient(90deg,rgba(0,0,0,.28) 0 .14em,transparent .14em .36em)` }} />
          <span className="o3d-fill" style={{ background: gloss }} />
          <span className="o3d-p left-[.5em] right-[.5em] top-[1.25em] h-[.12em] bg-black/20" />
          <Glyph Icon={Icon} ink={t.ink} className="left-1/2 top-[52%] h-[2.7em] w-[2.7em] -translate-x-1/2 -translate-y-1/2" />
        </span>
      );
    case "tag":
      return (
        <span className="o3d-p left-[1.9em] top-[1.9em] h-[6.8em] w-[6.2em] -rotate-[10deg]">
          <svg viewBox="0 0 62 30" className="o3d-p -top-[2.3em] left-[1.6em] h-[3em] w-[6.2em] overflow-visible" aria-hidden="true">
            <path d="M15 30 C 10 12, 30 2, 52 6" fill="none" stroke="#e9e3d0" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
          <span className="o3d-p o3d-face inset-0 rounded-[.9em] [clip-path:polygon(24%_0,76%_0,100%_20%,100%_100%,0_100%,0_20%)]" style={{ background: `linear-gradient(165deg,${t.a} -15%,${t.b} 38%,${t.c} 125%)` }}>
            <span className="o3d-fill" style={{ background: gloss }} />
            <span className="o3d-p left-1/2 top-[.75em] h-[1.05em] w-[1.05em] -translate-x-1/2 rounded-full bg-[#141416] shadow-[0_0_0_.2em_rgba(255,255,255,.55)]" />
            <Glyph Icon={Icon} ink={t.ink} className="left-1/2 top-[56%] h-[2.8em] w-[2.8em] -translate-x-1/2 -translate-y-1/2" />
          </span>
        </span>
      );
    case "device":
      return (
        <>
          <span className="o3d-p left-[1.1em] top-[7.5em] h-[1.3em] w-[7.8em] rounded-[.4em] [clip-path:polygon(6%_0,94%_0,100%_100%,0_100%)]" style={{ background: `linear-gradient(180deg,${t.b},${t.c})` }} />
          <span className="o3d-p o3d-face left-[1.6em] top-[1.4em] h-[6.1em] w-[6.8em] rounded-[1em]" style={{ background: `linear-gradient(165deg,${t.a} -10%,${t.b} 45%,${t.c} 140%)` }}>
            <span className="o3d-fill" style={{ background: gloss }} />
            <span className="o3d-p left-[.6em] right-[.6em] top-[.6em] h-[3.9em] rounded-[.65em] bg-[#0b0d12] shadow-[inset_0_0_0_.14em_rgba(0,0,0,.5),inset_0_0_1.1em_rgba(120,255,200,.12)]">
              <Icon className="o3d-glyph left-1/2 top-1/2 h-[2.3em] w-[2.3em] -translate-x-1/2 -translate-y-1/2" style={{ color: t.a === "#f1f1f4" ? "#c2f415" : t.a }} strokeWidth={2.5} aria-hidden="true" />
              <span className="o3d-fill rounded-[.65em]" style={{ background: "linear-gradient(130deg,rgba(255,255,255,.18),transparent 40%)" }} />
            </span>
            <span className="o3d-p bottom-[.55em] left-[.75em] h-[.3em] w-[2.4em] rounded-full bg-black/30" />
            <span className="o3d-p bottom-[.45em] right-[.75em] h-[.55em] w-[.55em] rounded-full bg-black/30" />
            <span className="o3d-p bottom-[.45em] right-[1.55em] h-[.55em] w-[.55em] rounded-full bg-black/20" />
          </span>
        </>
      );
  }
}

function Barcode({ className }: { className?: string }) {
  return (
    <span className={cn("o3d-p o3d-sticker o3d-minor bg-white px-[.25em] pb-[.12em] pt-[.2em]", className)}>
      <span className="block h-[.85em] w-[2.3em] [background:repeating-linear-gradient(90deg,#111_0_.07em,transparent_.07em_.15em,#111_.15em_.19em,transparent_.19em_.32em,#111_.32em_.44em,transparent_.44em_.52em)]" />
    </span>
  );
}

function Star({ className }: { className?: string }) {
  return (
    <span className={cn("o3d-p o3d-sticker o3d-holo grid h-[1.9em] w-[1.9em] place-items-center rounded-full", className)}>
      <svg viewBox="0 0 24 24" className="h-[1.1em] w-[1.1em]" fill="#fff" aria-hidden="true">
        <path d="M12 2l2.6 6.9L22 9.5l-5.6 4.7L18.2 22 12 17.8 5.8 22l1.8-7.8L2 9.5l7.4-.6L12 2z" />
      </svg>
    </span>
  );
}

export function Icon3D({
  name,
  size = 64,
  alt = "",
  className,
}: {
  name: IconName;
  size?: number;
  alt?: string;
  className?: string;
  /** kept for API compatibility; the objects are pure CSS so there is nothing to preload */
  priority?: boolean;
}) {
  const [shape, tone, Icon, label] = SPEC[name];
  const t = TONES[tone];
  const seed = [...name].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const stickerBg = STICKERS.filter((c) => c.toLowerCase() !== t.a.toLowerCase())[seed % 4];
  const flip = seed % 2 === 0;
  return (
    <span
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={cn("o3d", className)}
      style={{ ["--o3d" as string]: `${size}px` }}
    >
      <span className="o3d-art">
        <span className="o3d-floor" />
        <Body shape={shape} t={t} Icon={Icon} />
        <span
          className={cn("o3d-p o3d-sticker rounded-[.3em] px-[.4em] py-[.12em] font-mono text-[.78em] font-black leading-[1.15] tracking-tight text-black", flip ? "left-[.5em] top-[4.2em] -rotate-[12deg]" : "right-[.3em] top-[5.6em] rotate-[9deg]")}
          style={{ background: stickerBg }}
        >
          {label}
        </span>
        {seed % 3 !== 1 && <Star className={flip ? "right-[.6em] top-[1.1em] rotate-[12deg]" : "left-[.7em] top-[1.3em] -rotate-[10deg]"} />}
        {seed % 3 !== 2 && <Barcode className={flip ? "bottom-[1.3em] right-[.9em] rotate-[7deg]" : "bottom-[1.2em] left-[1.1em] -rotate-[6deg]"} />}
      </span>
    </span>
  );
}
