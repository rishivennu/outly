# fix-1017-analytics-subs (Analytics redesign + FunClip-style subtitles)

Upload every file in this folder to the repo root, keeping the paths. 30 files (plus this note).
Cumulative on top of fix-1016l-ux: upload fix-1016-all, then fix-1016l-ux, then this folder. Where two bundles have the same file, the newer folder wins.
Do NOT upload vercel.json, tsconfig.json, .env, prisma/schema.prisma or any .db file.

## Before it goes live
- No database change in this bundle. The settings rows `engine:captions` and `engine:subtitles` (Setting table) are created automatically the first time they are read.
- Optional env: FUNASR_URL and FUNASR_TOKEN, only if you later host a FunASR worker. Without them subtitles use Gemini, as now.
- Still pending from earlier bundles: `npx prisma db push` (PostTarget.firstComment*, Plan.yearlyMinor).

## What changed

1. Analytics page redesign
- One shared section header (kicker, title, description, actions). Page held to 1320px, range picker next to the title, bigger stat cards, chart fills its card.
- "Published through Outlly" comes first, then live accounts, then the profile review.
- "Where it landed" lists only platforms with views, then one line for the rest.
- No accounts linked: one "Connect accounts" banner instead of a row of empty tiles. Errors show an icon and muted text, with "Try again" on the review.
- Profile review: 12-column layout, score card plus "Key numbers", 2-column pillars, solid colour score ring and bars, "Do this next" and "By platform" side by side.
- No text under 13px; the "high impact" badge contrast is fixed (was 3.7:1). axe 0 at 1280 light and 390 dark.
  components/analytics/{SectionHead,AnalyticsView,LiveStrip,ProfileReview}.tsx, app/globals.css

2. Subtitle engine (ideas from modelscope/FunClip, MIT)
- Transcription now returns timings for every word (Gemini), with your hotwords. Lines break on sentences, pauses, speaker changes and length limits.
- Optional FunASR worker: set provider "funasr" plus a worker URL in the engine settings; any failure falls back to Gemini.
- Engine settings live in the database (Setting `engine:subtitles`, next to `engine:captions`), cached 5 minutes. Admin API: GET/PUT /api/admin/engines (integrations role). Unsafe URLs are dropped and numbers are clamped.
- Create > Captions: new "Cut clips from what you said" panel. Type words to keep (# for several), or "Find highlights" (Gemini picks the best moments, POST /api/ai/highlights, 10 per minute, counts toward AI quota). Preview each part, cut the video to just those parts in the browser (captions burned in optional), or download a .srt for the cut. The cut uploads as your video.
  lib/captions/subtitle-engine.ts, lib/ai/transcribe.ts, lib/ai/engine-store.ts, lib/env.ts, app/api/ai/highlights/route.ts, app/api/admin/engines/route.ts, lib/client/captions.ts, components/create/{ClipCutter,CaptionBurner,CreateWorkspace}.tsx

3. Caption engine and smaller fixes (10-17, not bundled before)
- Caption writing rules stored as Setting `engine:captions`. lib/ai/caption-engine.ts, lib/ai/engine-store.ts, lib/ai/creative.ts, lib/client/checks.ts, components/create/{types.ts,PlatformDeck.tsx}
- Phone popup hint for small screens (components/shared/DeviceHint.tsx, app/layout.tsx).
- Heading order fixes: AuthShowcase, LogoTicker, HelpCenter, Tour. Command palette button on one line and focus fix: PaletteButton, CommandPalette.

## Checked
- bun test: 456 pass, 0 fail (new: tests/round-1017-captions, tests/round-1017-subtitles). tsc clean.
- Live with real Gemini: a 9 s clip came back as 22 timed words in 4 lines; highlights returned a clip; admin settings saved and restored.
- Not yet clicked through in a browser: the clip cutter panel itself (its server calls are verified).
