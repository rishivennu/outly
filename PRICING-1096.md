# Round 1096: November 2026 pricing (roadmap steps 1 to 4)

Strategy: `Outlly-Pricing-Strategy-2026-11.pdf`. This round ships the machinery. **No live plan changes by
itself.** Every new price and limit is either a new field that defaults to "no change" or part of a preset
an admin applies by hand in Admin > Pricing, with an Undo.

## Safe by default

| New thing | Default | Effect until an admin changes it |
|---|---|---|
| Plan `platformLimit`, `brandLimit`, `xPostLimit`, `fairUsePosts` | 0 | not limited (as before) |
| Plan `analyticsDays` | 0 | the standard 90 days (as before) |
| Plan `perks` | "" | every perk (as before) |
| Plan `yearlyPrices` | {} | yearly prices scaled from monthly (as before) |
| Setting `topups.enabled` | false | no packs on sale |
| Setting `experiments.price.enabled` | false | no price test |
| Subscription `autoRenew` | false | reminder emails only; customer opts in |

`prisma db push` adds the columns and tables; no data migration runs.

## Step 1: plans and limits
- Free: any N platforms (`platformLimit`), reconnecting one already used never counts.
- Brands: `brandLimit` = accounts per platform; brand packs add room for their days.
- X posts: counted per X destination per UTC month (`x-post` FeatureUse); retries free; past the allowance an X pack pays one unit. Every X target is charged when it is booked, including X added later to an already-booked post; a target that fails for good gives its slot (and any pack unit) back via `releaseXPost`.
- Analytics, reports and dashboard cap history at `analyticsDays` (max 730, prune at 730).
- Fair use on unlimited posts: an admin alert the first time an account passes it in a period. Never a block.
- Perks (gated server side): weekly-digest, voice-memory, csv-export, client-reports, approvals, spike-alerts, ai-replies, review-links.
- Preset `pricing-2026-11` (Admin > Pricing > "November 2026 pricing"): Free / Starter (new) / Creator / Agency (pro-manager renamed), Studio hidden. People on Studio keep it at their price. Optional switches: end "Free during beta", open the founding offer. **Undo** restores every field it touched and deletes Starter if nobody has used it (else hides it). Applying again while applied is refused with 409 `PRESET_APPLIED`, so the undo point can never be overwritten.

## Step 2: top-ups
- Admin > Pricing > Pricing lab > Top-ups: on/off, paid-plans-only, packs (kind ai | x | brand | seat, units, INR price, exact USD/EUR/GBP, days, plans).
- Billing shows usage bars and pack buttons; checkout uses the active gateway; one payment = exactly one pack (transaction). Refund ends the pack. Receipts say "Top-up: <label>".

## Step 3: retention
- Auto-renew (Billing toggle): Razorpay Subscriptions / UPI Autopay mandate, first charge at the end of the paid period; `subscription.*` webhooks turn it on, renew (idempotent on payment id) and turn it off. Mock gateway flips at once. Cancel and pause drop the mandate.
- Renewal reminders (retention cron, daily): 7 days and 1 day before the end, or 3 days before an auto-renew charge; each step once (`remindedFor`).
- Cancel reasons (optional) and "happy to talk" opt-in, listed with follow-up status in the lab.
- Voice memory (Creator+): the last 8 captions a creator shipped steer captions and hooks. Settings > Personalization: on/off and forget.

## Step 4: measure
- Price test: one at a time, per plan and currency, deterministic split per person (FNV hash), exposure / checkout / paid events, z-test per variant. Starts off.
- Van Westendorp survey on Billing (one answer per person), grouped by plan and currency.
- Decision rule card: 60-day free-to-paid >= 4% and monthly churn <= 6% to keep the structure. Gift (beta, referral) and sample rows don't count. Shows "not enough data" under 100 signups / 30 subscribers.

## Admin how-to
1. Admin > Pricing: review the preset table, press **Apply November 2026 pricing**, choose the beta / founding switches. Undo is on the same panel.
2. Fine-tune any plan in the editor, section 06 (brands, X, history, perks, yearly local prices).
3. Pricing lab: switch top-ups on; set a price test; read survey, cancel reasons and the decision card.
4. Razorpay: enable Subscriptions on the account and add the `subscription.*` events to the webhook.

## Tests
`tests/round-1096-pricing.test.ts`: plan rules, packs (incl. a race for the last unit), price tests and survey math, reminders, auto-renew charge idempotency, voice memory gating, decision metrics, and preset apply + undo leaving every plan row exactly as before.

## Review fixes (independent review, 2026-11-02)
- X allowance could be skipped by adding X to an already-booked post: every X target is now charged.
- A failed X target never returned its slot: `releaseXPost` on final failure.
- Price test charged a price the card never showed, and logged exposure at checkout: the billing page now shows the test price and records exposure; checkout only reads the assignment.
- A second preset Apply destroyed the undo backup: now a 409.
- Pack labels fell back to unclamped units: fixed.
- Analytics history line read "0 days" on current plans: shows the effective window (90 by default).
- Connect errors named every cap "account limit": platform and brand caps have their own messages.
- Pricing lab: add / remove packs and price-test variants, id and kind for new packs, EUR and GBP pack prices.

Known, accepted: `activeExtras` adds one groupBy per entitlements read. `renewFromCharge` trusts the amount on the verified webhook (Razorpay signs it); it does not compare against the stored subscription price.
