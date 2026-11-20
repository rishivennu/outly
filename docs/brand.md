# Outlly brand: logo and wordmark

One identity with two working forms. Everything renders through `components/brand/OutllyBrand.tsx`
(the code lives in `components/brand/Logo.tsx` next to the rocket art). Do not hand-roll a logo.

## Variants

| Variant | What | Where |
| --- | --- | --- |
| `full` | rocket + `outlly` wordmark | public site header and footer (`components/marketing/Nav.tsx`, `Footer.tsx`), sign in / sign up (`AuthShowcase` on desktop, `AuthForm` below 1024px), studio desktop rail (`PulseRail`, as parts), admin desktop sidebar and admin drawer (`AdminShell`), PWA welcome, invite / maintenance / test checkout pages, emails |
| `compact` | rocket alone in a 44px header slot | phone headers when the row is crowded, compact nav. `compactBelow` turns a `full` lockup into the rocket alone under a width (360, 400, 480 or 640 px), CSS only |
| `icon` | the bare rocket | tiles, loading, small identifiers, the collapsed admin sidebar |

```tsx
import { OutllyBrand, OutllyLogoIcon, OutllyWordmark } from "@/components/brand/OutllyBrand";

<OutllyBrand />                              // full, follows the text size (wordmark 1.15em, rocket 1.08em of it)
<OutllyBrand size={30} />                    // full, rocket 30px tall, wordmark sized from it
<OutllyBrand variant="compact" />            // 44px slot, 26px rocket
<OutllyBrand variant="icon" size={22} />
<OutllyBrand href="/" />                     // wrapped in a Link named "Outlly"
<OutllyBrand compactBelow={360} />           // rocket only on very narrow phones
<OutllyBrand label={false} />                // decorative: the parent link already says "Outlly ..."
```

Props: `variant` (`icon | compact | full`, default `full`), `size` (rocket height in px), `tone`
(`auto` follows the theme; `light` = sits on a light surface, `dark` = sits on a dark surface), `className`,
`href`, `label` (accessible name, default "Outlly"; `false` hides it from assistive tech), `compactBelow`.

`OutlyLogo` and `OutlyMark` are the older names and stay supported: `OutlyLogo` renders the `full` lockup,
`OutlyMark` the rocket art (also its `tile`, `glyph`, `ink` and `white` treatments for special surfaces).

Phone header rows (studio `MobileTopBar`, admin `.admin-top`) are owned by the header work: studio shows the
full lockup, folding to the rocket when crowded, and never adds a page title as a third brand element; admin
shows the rocket + "Admin".

## Rules

- **Art, not redraw.** The rocket is the supplied raster (`public/brand/rocket/*`, square, WebP 96/256). Never
  redraw it in CSS/SVG, never stretch it: width always equals height, `object-contain`.
- **Lime stays lime.** Dark surfaces get `rocket-*.webp` (lime gradient). Light surfaces get `rocket-lime-ink-*.webp`,
  the same gradient deepened to stay readable on cream. With `tone="auto"` both are in the page and CSS shows one,
  so there is no flash and no client JS.
- **No plates.** No white tile behind the mark. The app-icon tiles (`public/brand/app/*`, `app/apple-icon.png`) are
  for OS icons and install prompts only.
- **Proportions.** Rocket = 1.08 x the wordmark font size, gap 0.16em, both centred on one line. Use `size` or the
  surrounding font size; never set width and height on the lockup.
- **Clear space.** Keep at least half the rocket height free on every side of a full lockup (a 44px header row
  already gives this).
- **Minimum sizes.** Rocket 16px; full lockup with a wordmark of at least 14px. Below that use `icon`.
- **One per view.** One brand element per screen region: the header shows it, page content does not repeat it.
  Sign in shows it once (the showcase panel on desktop, the form below 1024px). Admin pages never repeat the
  wordmark inside page content.
- **Accessible name once.** The wrapper is `role="img"` named "Outlly"; the art inside is `alt=""` + `aria-hidden`.
  Inside a named link pass `label={false}`.
- **Copy.** The wordmark is lowercase `outlly`; in sentences the name is "Outlly". No emoji rockets.

## Assets

| File | Size | Use |
| --- | --- | --- |
| `public/brand/rocket/rocket-{96,256}.webp` | square, transparent | lime rocket on dark |
| `public/brand/rocket/rocket-lime-ink-{96,256}.webp` | square, transparent | deepened lime rocket on light |
| `public/brand/rocket/rocket-{ink,white,deep}-{96,256}.webp` | square, transparent | one-colour treatments (buttons, launch art) |
| `public/brand/rocket/mark-{64,128,256}.webp`, `mark-light-{64..512}.webp` | square tile | `OutlyMark variant="tile"` |
| `public/brand/rocket/rocket-ink-256.png` | square | invoice PDF (`lib/billing/invoice-art.ts`) |
| `public/brand/rocket/mark-anim.gif` | 96x96 | email header lockup |
| `public/brand/email/retro/wordmark.png` | 962x286 | email footer wordmark (`width=250 height=74`) |
| `app/icon.png` | 96x96 transparent | favicon (lime rocket) |
| `app/apple-icon.png` | 180x180 opaque | iOS home screen (white rocket on the lime tile) |
| `public/brand/app/icon-{192,512}.png`, `icon-512-maskable.png` | square | manifest icons, install prompts |
| `public/brand/app/badge-96.png` | 96x96 white | Android notification badge |
| `public/brand/founding/*` | stickers | founding member art (not the logo) |

`app/icon.svg` was the pre-rocket mark and was removed in R1285 so `/icon.svg` can never serve the old logo.

## Checks

`tests/round-1285-brand.test.ts` pins the component API, every slot, the asset ratios and the absence of raw rocket
`<img>` tags outside `components/brand` and the email templates.
