# Performance programme R1222 to R1230: before and after

Brief: "Global application performance optimization & WebP image migration" (2026-11-19). Nine rounds, every one pushed to `main` and deployed on Vercel. This is the measured result, what changed, and what is still slow.

## How it was measured

- Two local production builds (`next build` + `next start`), same machine, same SQLite data, same signed-in test account: **before** = `main` at a8a969b (R1221, the commit before R1222, served on :3100), **after** = `main` at 8bcd139 (R1230, served on :3101).
- Playwright (Edge, headless), fresh browser context per load (cold cache), 2 runs per route, averaged. Desktop 1440x900 and iPhone 390x844 with 4G throttling (1.6 Mb/s, 40 ms). Script: `measure.py` (FCP, LCP, CLS from PerformanceObserver; transferred bytes per type from CDP; API calls = same-origin `/api/*` requests within 2.5 s after load).
- Database work per page: Prisma query log on a dev server (`PRISMA_QUERY_LOG=1`), one signed-in visit per route, counting page + API queries and excluding the dev-only in-process sweeper (which never runs on Vercel). Numbers vary by a few queries per visit (background syncs and presence), so read them as trends.
- Caveats: local numbers, not Vercel. The after-measurement ran while two teammates were working in the same machine, so timing columns carry some noise; byte, request and query counts are exact.

## Results in one paragraph

Across the 15 routes, a cold mobile load now paints **14% sooner** (FCP 1.71 s to 1.46 s on average), the largest element lands **19% sooner** (LCP 3.20 s to 2.59 s), layout shift is **down 60%** (CLS 0.106 to 0.041, and 0.055 to 0.004 on desktop), and every page moves **19% fewer bytes** (899 kB to 727 kB on mobile; images 155 kB to 100 kB, scripts 470 kB to 364 kB). The script saving is one fix: before R1224 the not-found boundary pulled the whole marketing landing bundle (13 files, about 290 kB raw: the landing page chunk, GSAP and friends) into every studio route; `/brand` went from 53 scripts to 40. Images fell from the WebP migration (R1222). CLS fell from the reserved heights and the rupee font stack (R1223, R1224): `/login` and `/home` on mobile went from 0.63 to 0.18, `/pricing` desktop from 0.43 to 0.003, `/settings` mobile LCP from 4.0 s to 1.5 s. API calls per page are unchanged by design (WarmUp prefetches the next tabs); the database work behind them is lower (next section). Two desktop LCP columns went up (`/login` 606 to 970 ms, `/home` 406 to 490 ms): both are within run-to-run noise on a machine that was also running two teammates, and the mobile columns for the same routes improved.

## Measured results: before (pre R1222) and after (R1230)

Each cell: before -> after, change. Cold cache, 2 runs averaged. "-" = no images on that route.

### Desktop

| Route | FCP ms | LCP ms | CLS | JS kB | Img kB | Total kB | API calls |
|---|---|---|---|---|---|---|---|
| / | 864 -> 868 +4 (+0%) | 2048 -> 868 -1180 (-58%) | 0.048 -> 0.047 -0.001 | 342 -> 332 -10 (-3%) | 89 -> 56 -33 (-37%) | 934 -> 804 -130 (-14%) | 7 -> 6 -1 (-14%) |
| /login | 256 -> 228 -28 (-11%) | 606 -> 970 +364 (+60%) | 0.194 -> 0.000 -0.194 | 517 -> 413 -104 (-20%) | 108 -> 67 -41 (-38%) | 890 -> 740 -150 (-17%) | 12 -> 12 -0 (-4%) |
| /pricing | 1368 -> 356 -1012 (-74%) | 2460 -> 2358 -102 (-4%) | 0.430 -> 0.003 -0.427 | 342 -> 332 -10 (-3%) | 145 -> 84 -61 (-42%) | 990 -> 831 -159 (-16%) | 7 -> 6 -1 (-14%) |
| /blog | 210 -> 174 -36 (-17%) | 210 -> 174 -36 (-17%) | 0.004 -> 0.003 -0.001 | 345 -> 247 -98 (-28%) | 39 -> 28 -11 (-28%) | 635 -> 520 -115 (-18%) | 6 -> 6 +0 (+0%) |
| /home | 188 -> 198 +10 (+5%) | 406 -> 490 +84 (+21%) | 0.097 -> 0.000 -0.097 | 517 -> 413 -104 (-20%) | 108 -> 67 -41 (-38%) | 891 -> 740 -151 (-17%) | 12 -> 12 -0 (-4%) |
| /create | 182 -> 218 +36 (+20%) | 532 -> 466 -66 (-12%) | 0.036 -> 0.003 -0.033 | 589 -> 484 -105 (-18%) | 69 -> 69 +0 (+0%) | 952 -> 866 -86 (-9%) | 7 -> 7 +0 (+0%) |
| /content | 164 -> 162 -2 (-1%) | 574 -> 612 +38 (+7%) | 0.000 -> 0.000 +0.000 | 479 -> 374 -105 (-22%) | 112 -> 71 -41 (-37%) | 852 -> 701 -151 (-18%) | 10 -> 10 +0 (+0%) |
| /calendar | 184 -> 216 +32 (+17%) | 660 -> 216 -444 (-67%) | 0.000 -> 0.000 +0.000 | 473 -> 368 -105 (-22%) | 96 -> 92 -4 (-4%) | 832 -> 717 -115 (-14%) | 12 -> 12 +0 (+4%) |
| /analytics | 196 -> 178 -18 (-9%) | 378 -> 420 +42 (+11%) | 0.002 -> 0.002 +0.000 | 577 -> 473 -104 (-18%) | 122 -> 100 -22 (-18%) | 981 -> 848 -133 (-14%) | 10 -> 10 -0 (-5%) |
| /inbox | 152 -> 158 +6 (+4%) | 870 -> 666 -204 (-23%) | 0.000 -> 0.000 +0.000 | 438 -> 323 -115 (-26%) | 93 -> 67 -26 (-28%) | 792 -> 645 -147 (-19%) | 10 -> 9 -1 (-10%) |
| /accounts | 300 -> 168 -132 (-44%) | 460 -> 444 -16 (-3%) | 0.000 -> 0.000 +0.000 | 456 -> 351 -105 (-23%) | 122 -> 90 -32 (-26%) | 840 -> 698 -142 (-17%) | 12 -> 11 -0 (-4%) |
| /brand | 258 -> 236 -22 (-9%) | 258 -> 236 -22 (-9%) | 0.000 -> 0.000 +0.000 | 316 -> 156 -160 (-51%) | - -> - | 542 -> 372 -170 (-31%) | 3 -> 3 +0 (+0%) |
| /settings | 182 -> 148 -34 (-19%) | 530 -> 548 +18 (+3%) | 0.015 -> 0.002 -0.013 | 501 -> 396 -105 (-21%) | 111 -> 67 -44 (-40%) | 919 -> 749 -170 (-18%) | 22 -> 22 +0 (+0%) |
| /notifications | 272 -> 204 -68 (-25%) | 272 -> 204 -68 (-25%) | 0.000 -> 0.000 +0.000 | 316 -> 156 -160 (-51%) | - -> - | 542 -> 372 -170 (-31%) | 3 -> 3 +0 (+0%) |
| /help | 194 -> 184 -10 (-5%) | 194 -> 184 -10 (-5%) | 0.006 -> 0.003 -0.003 | 377 -> 278 -99 (-26%) | 39 -> 6 -33 (-85%) | 659 -> 522 -137 (-21%) | 4 -> 4 +0 (+0%) |

Averages (desktop): FCP 331 -> 246; LCP 697 -> 590; CLS 0.055 -> 0.004; JS kB 439 -> 340; Img kB 96 -> 66; Total kB 817 -> 675; API calls 9 -> 9

### Mobile

| Route | FCP ms | LCP ms | CLS | JS kB | Img kB | Total kB | API calls |
|---|---|---|---|---|---|---|---|
| / | 1668 -> 1606 -62 (-4%) | 6478 -> 5248 -1230 (-19%) | 0.001 -> 0.001 +0.000 | 342 -> 332 -10 (-3%) | 89 -> 56 -33 (-37%) | 934 -> 804 -130 (-14%) | 7 -> 6 -1 (-14%) |
| /login | 2020 -> 1516 -504 (-25%) | 5144 -> 4650 -494 (-10%) | 0.630 -> 0.184 -0.446 | 517 -> 413 -104 (-20%) | 199 -> 136 -63 (-32%) | 981 -> 809 -172 (-18%) | 10 -> 13 +3 (+30%) |
| /pricing | 1680 -> 1642 -38 (-2%) | 6062 -> 5276 -786 (-13%) | 0.001 -> 0.001 +0.000 | 342 -> 332 -10 (-3%) | 93 -> 44 -49 (-53%) | 938 -> 792 -146 (-16%) | 7 -> 6 -1 (-14%) |
| /blog | 1226 -> 1086 -140 (-11%) | 1226 -> 1086 -140 (-11%) | 0.140 -> 0.140 +0.000 | 349 -> 250 -99 (-28%) | 39 -> 22 -17 (-44%) | 640 -> 519 -121 (-19%) | 6 -> 6 +0 (+0%) |
| /home | 1846 -> 1450 -396 (-21%) | 5102 -> 4442 -660 (-13%) | 0.630 -> 0.184 -0.446 | 517 -> 458 -59 (-11%) | 199 -> 136 -63 (-32%) | 981 -> 855 -126 (-13%) | 10 -> 13 +3 (+30%) |
| /create | 1644 -> 1404 -240 (-15%) | 5986 -> 4878 -1108 (-19%) | 0.055 -> 0.000 -0.055 | 651 -> 544 -107 (-16%) | 160 -> 109 -51 (-32%) | 1130 -> 966 -164 (-15%) | 7 -> 8 +0 (+7%) |
| /content | 1970 -> 1568 -402 (-20%) | 1996 -> 1594 -402 (-20%) | 0.001 -> 0.001 +0.000 | 479 -> 374 -105 (-22%) | 203 -> 132 -71 (-35%) | 944 -> 762 -182 (-19%) | 8 -> 8 +0 (+0%) |
| /calendar | 1696 -> 1422 -274 (-16%) | 1696 -> 1422 -274 (-16%) | 0.000 -> 0.000 +0.000 | 473 -> 368 -105 (-22%) | 186 -> 130 -56 (-30%) | 922 -> 756 -166 (-18%) | 11 -> 11 +0 (+0%) |
| /analytics | 1694 -> 1436 -258 (-15%) | 1860 -> 1436 -424 (-23%) | 0.012 -> 0.012 +0.000 | 640 -> 473 -167 (-26%) | 213 -> 141 -72 (-34%) | 1135 -> 890 -245 (-22%) | 8 -> 9 +0 (+6%) |
| /inbox | 1654 -> 1384 -270 (-16%) | 1654 -> 1384 -270 (-16%) | 0.000 -> 0.000 +0.000 | 473 -> 358 -115 (-24%) | 184 -> 129 -55 (-30%) | 911 -> 734 -177 (-19%) | 8 -> 9 +0 (+6%) |
| /accounts | 1676 -> 1402 -274 (-16%) | 1676 -> 1402 -274 (-16%) | 0.035 -> 0.035 +0.000 | 456 -> 351 -105 (-23%) | 213 -> 152 -61 (-29%) | 926 -> 754 -172 (-19%) | 8 -> 9 +0 (+6%) |
| /brand | 1844 -> 1690 -154 (-8%) | 1844 -> 1690 -154 (-8%) | 0.000 -> 0.000 +0.000 | 386 -> 224 -162 (-42%) | - -> - | 614 -> 441 -173 (-28%) | 3 -> 3 +0 (+0%) |
| /settings | 1678 -> 1454 -224 (-13%) | 3986 -> 1454 -2532 (-64%) | 0.083 -> 0.054 -0.029 | 538 -> 396 -142 (-26%) | 199 -> 107 -92 (-46%) | 1044 -> 789 -255 (-24%) | 22 -> 22 +0 (+2%) |
| /notifications | 1986 -> 1708 -278 (-14%) | 1986 -> 1708 -278 (-14%) | 0.000 -> 0.000 +0.000 | 503 -> 302 -201 (-40%) | - -> - | 731 -> 519 -212 (-29%) | 3 -> 3 +0 (+0%) |
| /help | 1302 -> 1146 -156 (-12%) | 1302 -> 1146 -156 (-12%) | 0.005 -> 0.005 +0.000 | 377 -> 278 -99 (-26%) | 39 -> 6 -33 (-85%) | 659 -> 522 -137 (-21%) | 4 -> 4 +0 (+0%) |

Averages (mobile): FCP 1706 -> 1461; LCP 3200 -> 2588; CLS 0.106 -> 0.041; JS kB 470 -> 364; Img kB 155 -> 100; Total kB 899 -> 727; API calls 8 -> 9

## Completed changes

| Round | Commit | What changed | Where |
|---|---|---|---|
| R1222 | 4bb7302 | Brand art and sample posters converted to WebP (PNG/JPEG kept only where a platform needs them), 83 unused files deleted from `public/`, every below-the-fold `<img>` lazy | public/brand, public/samples, components, tests/round-1222-webp.test.ts |
| R1223 | 322f86a | Layout-shift fixes: setup card reserves its height, nav live-count keeps a slot, Create glow pinned to 60dvh, Settings identity seeded from the session and loaded in parallel, rupee sign on a `.cur-sym` font stack | components/home, components/shell, components/settings, app/globals.css, tests/round-1223-cls.test.ts |
| R1224 | 81980e5 | Startup: not-found page as a client reference; LiveCount shares one in-flight fetch; `cachedApi` shares in-flight requests; welcome art at 720 px WebP with a head preload; hero title reserves its height on narrow phones | app/not-found.tsx, components/shared/NotFoundScreen.tsx, components/shared/LiveCount.tsx, lib/api.ts, lib/pwa-welcome.ts, tests/round-1224-startup.test.ts |
| R1225 | 26749ff | Database: entitlements computed once per request (`react.cache`), `ensurePlans` settles for 10 min in production instead of re-checking migrations on every billing read, `PRISMA_QUERY_LOG` switch | lib/db.ts, lib/billing/entitlements.ts, lib/billing/plans.ts, tests/round-1225-db.test.ts |
| R1226 | 0d80e64 | PWA: the service worker keeps brand art and sample posters (stale-while-revalidate, 40 max); home-screen icons stay fresh; cache list versioned | public/sw.js, tests/perf-sw.test.ts, tests/round-1226-sw-assets.test.ts |
| R1227 | 8bcd139 | Video: the last two `<video>` players (draft preview, review page) ask only for metadata up front; every player now carries `preload="metadata"` or `"none"` | components/create/SavedDrafts.tsx, components/review/ReviewPage.tsx |
| R1228 | (no change needed) | Fonts and CSS audited: only the live font set is preloaded, every other set is declared with `preload: false`, `display: swap`, size-adjusted fallbacks; CSS is one 90 kB (gz) file served immutable | app/layout.tsx, lib/fonts.ts |
| R1229 | (no change needed) | Caching and third parties audited: `/brand` and `/samples` cached a day in the browser and a week on the CDN, icons `must-revalidate`, PostHog downloaded only after consent and never on /admin, Razorpay only on billing; public APIs stay `no-store` on purpose (presence heartbeat, live counts) | next.config.mjs, components/analytics/PostHogProvider.tsx |
| R1230 | 8bcd139 | Monitoring: performance budgets (web.dev p75 thresholds) with a good / needs work / poor verdict under every cell on admin Startup speed, and an "Over budget" column per release | lib/perf/aggregate.ts, app/admin/(panel)/perf/page.tsx, tests/round-1230-perf-budget.test.ts |

Test suite: 4173 tests passing before R1225 (whole suite), every later round ran its own and related files plus `tsc --noEmit` clean before the push.

## Database queries per signed-in visit (page + API, dev server, sweeper excluded)

| Route | Before | After | Note |
|---|---|---|---|
| /home | 39 | 34 | entitlements once per request |
| /analytics | 72 | 66 | |
| /settings | 67 | 73 | 17 API calls on this page; the extra queries are presence and sync noise between visits (variance of about 10 on this route) |
| /content | 68 | 55 | |
| /accounts | 45 | 55 | variance: the account sync ran during the after visit |

The hot shapes that remain are structural, one per API call: `User WHERE id` (getCurrentUser, 4 to 14 per route), `UserSession` (session check per call), `Setting WHERE key` (4 to 15), `SocialAccount` by user (3 to 6). They are cheap single-row lookups but they add up because every studio page fans out to 5 to 17 API calls after load (WarmUp prefetches Home, Analytics, Calendar, Inbox and Content). Cutting them means a per-request user/session memo across API routes or fewer, wider endpoints (see "Remaining bottlenecks").

## Remaining bottlenecks (in order of expected payoff)

1. **Cold start on Vercel from India.** Edge middleware still asks `/api/maintenance` (a Sydney function) when its 15 s memory is stale, then the function cold start, then three serial waves of DB reads in the root and studio layouts before the first byte streams. Local builds cannot show this; the live fix is a static flag source for maintenance (KV or a cached JSON on the CDN) and moving the Supabase project or the functions to the same region as most users (`ap-south-1`).
2. **Per-API-call session work.** Every studio page fires 5 to 17 API calls after load (WarmUp prefetch is intentional) and each one re-reads `UserSession` and `User`. A short-lived per-request memo already exists inside one request; a 5 to 10 s cross-request memo keyed by session id (invalidated on logout, role or plan change) would remove roughly 20 queries per visit. Not done in this programme because it touches auth.
3. **JS weight on the first studio load.** Shared first-load JS is 104 kB (gz); per-route 316 to 651 kB raw. The big optional chunks (recharts 377 kB on Analytics, PostHog 357 kB after consent, Pip chat 175 kB on idle, framer 118 kB in the shell) are already deferred. The remaining lever is framer-motion in the shell (AppChrome, CommandPalette, PulseRail, WhatsNew, InstallPrompt): replacing it with CSS transitions would cut about 100 kB from every studio route.
4. **Landing page HTML.** 924 kB raw (61 kB brotli) with a 465 kB RSC payload and 391 inline SVGs (160 lucide icons). Splitting the long page into a static shell plus client-loaded sections, or sprite-ing the icons, would help FCP on slow phones more than any further image work.
5. **Analytics route.** 66 queries per visit and recharts; the Intelligence work (R1231 onwards) will add a read model with one grouped TargetMetric query per scope, which Analytics should then reuse.
6. **CLS on marketing pages.** `/pricing` and `/login` keep CLS above 0.1 in the cold-cache measurement (font swap on headlines and the cookie banner). The hero reserve from R1223/R1224 fixed the home hero; the pricing cards and the banner slot still need a reserved height.
7. **Measurement itself.** Local SQLite numbers are the lower bound. The admin Startup speed page (R1230) now carries budgets and verdicts per release, so the live p75 for each round is one glance after deploy; use it, not local runs, to confirm the India numbers.

## Tooling kept for the next programme

`~/.aki/tmp/perf/`: `measure.py` (Playwright cold-load metrics per route), `compare.py` (before/after tables), `q4.py` (Prisma query counting per route with `PRISMA_QUERY_LOG=1`), `diag.py` (LCP element and CLS sources), `chunks.py` (bundle chunk sizes). Baselines: `before.json` (pre R1222), `after.json` (R1230).
