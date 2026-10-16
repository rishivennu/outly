# fix-1016i: admin Pricing page redesign

Upload these 2 files over the repo (same paths). No database or env changes.

- components/admin/PricingEditor.tsx
  - Plan rail is now Live Activity cards (la-card la-themed): dot-letter plan name, price, interval, active subscriber count, and an on-site state row. Dashed "Add a plan" tile at the end.
  - Editor is one Live Activity card with numbered sections: 01 Basics, 02 Price (with local prices), 03 What's included, 04 On the site, 05 Plan limits.
  - Sticky rounded save bar (status, delete, Undo, Save & publish). The settled "Saved" state uses the subtle button so it stays readable.
  - Right column: live preview plus a new "When you save" card that explains, from what is on screen, what saving changes (site state, currencies, existing subscribers).
  - Save, validate, delete and plan-pick logic is unchanged.
- components/brand/DotText.tsx
  - Now supports A-Z, 0-9, + and - (unknown characters are dropped), and takes an optional className for size (default h-9). Existing callers are unchanged.

Checks: tsc 0, axe 0 (light and dark, desktop and mobile), no horizontal scroll, text contrast 4.5:1 or better in both themes.
