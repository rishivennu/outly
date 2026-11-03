# Rounds 1112 + 1113: revised prices and limits, and speed

Model: `Outlly-Unit-Economics-Model-2026-11.xlsx` (11 sheets, every number a live formula).
**No live plan change by itself.** The revision is a second preset an admin applies by hand, with an Undo.

## 1112: revision `pricing-2026-11-r2` (Admin > Pricing > "Revised prices and limits")

Needs the first preset (`pricing-2026-11`) applied; refused with 409 `PRESET_MISSING` otherwise and
409 `PRESET_APPLIED` if already applied. While it is applied, Undo of the first preset is refused (409 `REVISION_APPLIED`).

| Plan | INR / month | USD / EUR / GBP | Posts | X posts | Captioned videos | AI / month | AI / day | Storage | Replies / week |
|---|---|---|---|---|---|---|---|---|---|
| Free | 0 | 0 | 3 / week | not on plan | 3 | 15 | 5 | 1 GB | |
| Starter | 379 | 8 / 8 / 7 | 45 | 15 | 25 | 60 | 10 | 5 GB | 8 |
| Creator (highlight) | 979 | 17 / 17 / 14 | 150 | 40 | 60 | 200 | 25 | 25 GB | 35 |
| Agency (`pro-manager`, 5 seats) | 3,479 | 43 / 43 / 36 | 600 | 150 | 200 | 600 | 60 | 100 GB | 120 |

Yearly = 10 x monthly. Packs: AI +20 Rs 149, X +50 Rs 449, brand +1 Rs 449 (Creator, Agency), seat +1 Rs 229.
The packs' on/off and paid-only switches are kept as they are.

New behaviour:
- Plan `aiMonthly` / `aiDaily` (default 0 = old behaviour: no month cap, env `AI_DAILY_LIMIT` per day).
  Past the month cap AI returns 402 `PLAN_LIMIT` (feature `ai`). Support chat keeps its own daily cap.
- `xPostLimit = -1` means X is not on the plan: connecting X, booking an X post and buying an X pack are refused (402 `x`).
- A captioned video now costs 4 AI chunks (was 15), matching the model.
- Billing shows an "AI requests" meter (this month) and a locked X meter when X is not on the plan.
- Admin plan editor: "AI requests per month", "AI requests per day"; X allows -1.

Schema: `Plan.aiMonthly Int @default(0)`, `Plan.aiDaily Int @default(0)`. `prisma db push` adds them, no data migration.

## 1113: speed and Vercel Functions Storage

- Root layout inlines the mascot + font CSS (`lib/theme-css.ts`) instead of a render-blocking `/api/pip-theme` request
  to the function region on every first paint. The route stays for old cached HTML.
- Middleware reads the site flags stale-while-revalidate (60 s), refreshing in the background with `waitUntil`,
  instead of a no-store cross-region fetch on every request. `/api/maintenance` is CDN-cached 5 s (+30 s stale).
- `next.config.mjs` `outputFileTracingExcludes`: the file tracer copies `public/` (12 MB), tests, docs and CLI
  packages into server functions, because of `join(process.cwd(), "public", ...)` and `resolve(process.cwd(), "storage")`.
  None are read at runtime. `public/brand/app` stays (`lib/brand/icon-url.ts` hashes it). Measured on a local build
  (247 functions): the largest function drops from 33 MB to 6.7 MB of our files, before the Prisma engine.
- `vercel.json` `ignoreCommand` (`scripts/vercel-ignore.sh`): Functions Storage is every kept deployment's functions,
  so builds that never reach users are skipped. Preview branches build only with `[preview]` in the commit message;
  a production commit that only touches `*.md`, `tests/` or `docs/` is skipped. Anything else builds as before.

Owner steps (free):
1. Vercel > Project > Settings > Deployment Retention: shortest values; delete old deployments (each keeps its own functions).
2. Region: Supabase > Project Settings > General shows the DB region. Functions run in syd1. Keep syd1 while the DB is in
   Sydney (ap-southeast-2); moving functions to bom1 alone would add a round trip per query. Move both to Mumbai together, or neither.
3. Media on Cloudflare R2 (10 GB free, no egress fees): set `STORAGE_DRIVER=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (default `outlly-media`) in Vercel. Cuts media bandwidth; it does not change Functions Storage.
   Switching the driver does not move files already uploaded: copy the old bucket's objects (same keys) into R2 first
   (`rclone copy`), or old media links break. Worth it once Supabase Storage nears its free 1 GB.
