# fix-1034: guided tour Home to Settings + first-visit tips on every page

UPLOAD ORDER: upload AFTER fix-1033-csp-ux. components/shell/Nav.tsx here supersedes the copy in fix-1033.
Same paths as in the repo; replace each file. 4 files are NEW: components/onboarding/Spotlight.tsx, guides.ts, PageGuide.tsx, tests/round-1034-tour.test.ts.

## What it does
- Welcome tour: 12 stops (welcome, Home, New post, Content, Calendar, Analytics, Inbox, Approvals, Connected accounts, Billing, Help centre, Settings). Teammates skip the owner-only ones. On phones, pages not in the tab bar point at More.
- Page tips: the first time someone opens each page, up to 4 short tips for that page. Waits for the tour, cookie banner, privacy notice, welcome offer, update notice or any open dialog. Not shown on the page the tour just ran on. Pages with nothing to point at yet (no accounts connected) show one intro card.
- "Turn off tips" stops all of them. Settings > Replay the tour brings the tour and all tips back. Command palette: "Show tips for this page".
- Pip (chat) hides while tips are up and comes back after, including when you leave the page mid-tips.
- Keyboard: Esc, arrows and Tab trap work even after clicking the dimmed page. Reduced motion respected.

## Checked
791 tests pass, tsc 0, next build ok, CSP smoke 21/21, browser run at 1440 and 390 px on all 11 pages.
