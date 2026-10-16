# fix-1016k-pricing

Upload every file in this folder to the repo root, keeping the paths. 25 files (plus this note).

## fix-1016k (dark default, yearly pricing, rocket CTA, card style toggle)
- Dark is the default theme on every page (lib/theme/script.ts, ThemeToggle, app/layout.tsx, public/offline.html). A saved Light choice still wins.
- Yearly billing: Plan.yearlyMinor and Payment.interval (schema.template.prisma). lib/billing/cycle.ts works out the yearly price: the admin's yearly price if set, else monthly x (12 - months free). Monthly/Yearly switch (components/billing/CycleSwitch.tsx) on the landing page, billing page and admin preview. Checkout takes `cycle`; the subscription period follows the payment interval.
- Rocket CTA (components/billing/RocketCta.tsx): pricing buttons are a Live Activity bar; on click the fill slides across, the rocket lifts off, and a veil (LaunchHost in app/layout.tsx) slides in and out across the move to /billing (or /login when signed out). Reduced motion and Ctrl/Cmd clicks just navigate.
- Card style toggle: Admin > Pricing > "Card style and billing" picks Live Activity (current), Classic (previous), Glass or Bold. It applies to the landing page, billing page and admin preview straight away. Same panel: "Offer yearly billing" on/off and "Months free on yearly" (0 to 6). New app/api/admin/pricing-display/route.ts, lib/billing/display.ts, components/marketing/PricingCards.tsx.
- Light mode pricing cards: richer lime tints instead of pale ones.
- Verified: tsc 0, bun test 383/0, axe 0 (all 4 styles, light + dark, admin pricing, billing yearly), yearly checkout on the test gateway charged USD 59.99 with interval "year".
- PROD: run `npx prisma db push` (adds Plan.yearlyMinor and Payment.interval) before or with this deploy. Do not upload prisma/schema.prisma (generated at build).
