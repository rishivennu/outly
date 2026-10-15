# fix-1015-home (upload AFTER fix-1015-retention, at the repo root)

32 files. No new env vars, no schema change (mascot colours live in the existing site settings JSON).

- Home: Profile review removed. New bento: What to do next (big featured step that fills the card), This week (streak flame with Pip, tiers Spark / On fire / Blazing / Inferno, goal segments), Ideas (tinted notes, starters), Recycle.
- Streak flame: layered SVG flame, size, colour, flicker and sparks grow with the streak. Pip is happy on a streak and cheers once per new week. Idle Pip plays short gibberish antics after 9s of no input. Reduced motion and forced colours handled.
- Admin > Mascot colours (/admin/mascot): pick one of 12 palettes per situation (7 situations), reset to original. Served as CSS from /api/pip-theme, linked in app/layout.tsx.
- Analytics: "Profile review" and "Live from your accounts" headings use the same font as the Analyse with Gemini button. Duplicate empty-state summary line removed.
- Settings: Weekly report card redesigned and paired with Invite a friend; Snippets empty state filled with examples. No gaps left in the grid.
- Landing page platforms section: compact bento. Desktop: summary tile (live count, perks, CTAs) beside balanced rows of platform tiles; 768-1279px puts the summary on top as a strip. Mobile: sticky card stack, each card fully covers the previous one, which dims and shrinks (off under reduced motion). Each tile shows an Official API chip.
- Invisible watermark on every page (components/shared/Watermark.tsx, near-zero opacity, survives print). Studio pages add a second layer with a short per-account hash so leaked screenshots can be traced.
- Copyright: footer reads "© year Outlly. All rights reserved." plus a copyright meta tag in app/layout.tsx.
- Avatar cursor: mouse pointer replaced with the user's avatar only (photo or orb, no arrow, 32px, hotspot in the centre) on studio pages, lime ring on hover, text cursor kept in inputs. Toggle in Settings > Look. Desktop pointers only; forced colours fall back to the system cursor.
- Landing page "Watch one upload become three posts" section redesigned in the reference bento style with Apple HIG restraint: phone on a tinted stage, headline with one highlighted pill phrase and the step control under it, one violet accent tile (step, light word over bold word, live count), the three posts as soft tinted cards in one tray. Phones: swipe rail for the post cards, smaller phone. Contrast 4.5:1 in every tint, light and dark.
