# fix-1015-home (upload AFTER fix-1015-retention, at the repo root)

24 files. No new env vars, no schema change (mascot colours live in the existing site settings JSON).

- Home: Profile review removed. New bento: What to do next (big featured step that fills the card), This week (streak flame with Pip, tiers Spark / On fire / Blazing / Inferno, goal segments), Ideas (tinted notes, starters), Recycle.
- Streak flame: layered SVG flame, size, colour, flicker and sparks grow with the streak. Pip is happy on a streak and cheers once per new week. Idle Pip plays short gibberish antics after 9s of no input. Reduced motion and forced colours handled.
- Admin > Mascot colours (/admin/mascot): pick one of 12 palettes per situation (7 situations), reset to original. Served as CSS from /api/pip-theme, linked in app/layout.tsx.
- Analytics: "Profile review" and "Live from your accounts" headings use the same font as the Analyse with Gemini button. Duplicate empty-state summary line removed.
- Settings: Weekly report card redesigned and paired with Invite a friend; Snippets empty state filled with examples. No gaps left in the grid.
