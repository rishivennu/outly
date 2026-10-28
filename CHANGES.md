# fix-1033: enforce CSP + UX edge cases + UI polish

Upload AFTER fix-1032b (live). app/layout.tsx here supersedes the 1032b copy.

## CSP is now ENFORCED (was Report-Only)
- lib/csp.ts (new): per-request nonce; script-src 'self' 'nonce-X' 'strict-dynamic' (plus https: and 'unsafe-inline' as fallbacks that modern browsers ignore once a nonce is set); object-src 'none'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests in production.
- middleware.ts: makes the nonce, passes it to the page as x-nonce, sets Content-Security-Policy + Reporting-Endpoints on every response.
- app/layout.tsx: the 3 inline scripts carry the nonce.
- next.config.mjs: Report-Only header removed; /offline.html gets a static no-script CSP.
- app/api/csp-report/route.ts (new): receives violation reports (always 204, size-capped), logs "[csp] blocked X by directive on page" with no query strings.
- Cost: every page now renders per request (nonces cannot be cached).

After deploy: watch the Vercel logs for "[csp]" lines, and test one Razorpay checkout and one YouTube embed.

## Hardening from the independent review
- Offline page: "Try again" no longer uses an inline onclick (the script-free policy would kill it); it is a plain form reload.
- /api/csp-report: only CSP report content types, 30 reports a minute per visitor, every field stripped of control characters and capped (no forged log lines).
- Reporting-Endpoints now uses an absolute URL (browsers ignore a relative one).
- JSON-LD scripts on the landing and Help pages carry the nonce.
- form-action 'self' added; Razorpay's font origin allowed.
- Publishing note tracks online/offline live instead of reading it once.

## UX edge cases
- Create step 1: a note when no account is connected, linking to Connected accounts.
- Publishing screen: after 3 failed status checks in a row (while online), an honest "we can't reach Outlly" note; clears on the next success.
- Bulk planner: the sticky Book bar no longer hides under the mobile tab bar.
- Long usernames truncate instead of overflowing (PlatformDeck).
- Every text input and textarea uses dir="auto", so Arabic/Urdu/Hebrew captions type right-to-left.
- Approvals: each empty lane says what "empty" means instead of a bare "Empty".

## UI polish
- Create step 1 chips (MP4 or MOV / Vertical 9:16 / Saves as you go) had no styles and rendered as run-on text; now real chips (.pf-chip in globals.css).
- Sidebar: Workspace heading no longer touches Approvals; on short screens the sidebar scrolls instead of squashing the New post button.

## Checks
tsc 0 · bun test 783 pass / 0 fail · next build ok · browser CSP smoke 21/21 pages clean, injected inline script + onerror blocked and reported.

## Files (17)
- lib/csp.ts
- middleware.ts
- next.config.mjs
- app/layout.tsx
- app/api/csp-report/route.ts
- tests/round-1033-csp.test.ts
- public/offline.html
- app/(marketing)/page.tsx
- app/(marketing)/help/page.tsx
- components/create/PlatformDeck.tsx
- components/ui/field.tsx
- components/create/BulkPlanner.tsx
- components/approvals/ApprovalsBoard.tsx
- components/create/PublishingView.tsx
- components/create/CreateWorkspace.tsx
- app/globals.css
- components/shell/Nav.tsx
