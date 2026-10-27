# fix-1031-meta-dms

Upload this AFTER `outlly-all-1026b-to-1030.zip`. 41 files, copy them over the repo keeping the same folders.

Checks before bundling: `bun test` 674 pass / 0 fail (58 files), `npx tsc --noEmit` clean, `npx next build` ok.

## 1. Instagram and Facebook DMs (new)

What it does: a Messages tab in the Inbox shows Instagram DMs and Facebook Page (Messenger) conversations. You can read threads and reply from Outlly. New messages arrive through Meta's webhook.

Files: `lib/social/types.ts`, `app/(studio)/inbox/page.tsx`, `components/inbox/InboxView.tsx`, `components/inbox/MessagesView.tsx`, `app/api/messages/route.ts`, `app/api/messages/[id]/route.ts`, `app/api/webhooks/meta/route.ts`, `app/api/webhooks/meta/deletion/route.ts`, `lib/messages/*`, `lib/social/instagram.ts`, `lib/social/facebook.ts`, `lib/social/platform-setup.ts`, `lib/retention/prune.ts`, `lib/team/roles.ts`, `lib/validation.ts`, `lib/env.ts`, `lib/account.ts`, `lib/accounts.ts`, admin forms.

### After upload, do these in order

1. **Database.** Two new tables, `DmThread` and `DmMessage`. The build's db-sync step pushes them automatically. If you push by hand: `npx prisma db push`.
2. **Optional env.** `META_WEBHOOK_VERIFY_TOKEN`. If you leave it empty, Outlly makes its own token. Either way the token is shown in Admin > Social platforms.
3. **Meta dashboard, Webhooks.**
   - Callback URL: `https://outly-ecru.vercel.app/api/webhooks/meta`
   - Verify token: the one shown in Admin > Social platforms
   - Subscribe the **Instagram** product to `messages`, and the **Page** product to `messages`.
4. **Meta dashboard, Data deletion.** Callback URL: `https://outly-ecru.vercel.app/api/webhooks/meta/deletion`
5. **Reconnect.** Every creator must disconnect and reconnect Instagram and Facebook once, so the new permissions are granted:
   - Instagram: `instagram_business_manage_messages`
   - Facebook: `pages_messaging`, `pages_manage_metadata`
6. **App Review.** Until Meta approves those permissions, DMs only work for people with a role on the Meta app (admin, developer, tester). Steps are in the verification guide PDF.

## 2. Instagram "couldn't finish the handshake" on live

Cause: when Instagram swaps the login code for a token, it can wrap the answer as `{"data":[{"access_token":...}]}`. Our code only read the flat shape, so the token came out empty and the connect failed.

Fix (`lib/social/instagram.ts`): reads both shapes, URL-encodes the secret and tokens, and stops with a clear error if no token came back.

The error is now specific (`lib/social/connect-reason.ts`, callback route, `components/settings/AccountsView.tsx`). Instead of one generic message, the user sees which part failed: app settings (ID or secret), redirect URL, expired sign-in, Meta's server, or the token exchange. The server log also records the platform and the technical detail.

If it still fails after upload, check in the Meta dashboard:
- Instagram app ID and secret match Admin > Social platforms (Instagram app ID, not the Facebook app ID)
- Valid OAuth redirect URI is exactly `https://outly-ecru.vercel.app/api/accounts/instagram/callback`

Note: this fix follows Meta's documented response shape. It was not tested against the live logs.

If the creator unticks "Manage messages" on Instagram's consent screen, the connect still works, but Outlly now says that DMs won't arrive and how to fix it (reconnect and keep it ticked).

## 3. Home buttons "Create something" and "Open calendar" did nothing

Cause: the card fan's wrapper uses a negative top margin, so an invisible box sat over the buttons and swallowed the clicks.

Fix: `components/shared/HomeHero.tsx` and `components/marketing/Hero.tsx`. The fan wrapper ignores clicks (`pointer-events-none`), and the buttons sit above it. The fan looks the same. Checked in a browser at desktop and phone widths: both buttons navigate.

## 4. Welcome / Subscribe dialog

- **Hard-to-read text:** the card is now nearly opaque and the small text is darker. Passes the 4.5:1 contrast check (axe: 0 issues).
- **Close X sat on the left over the label:** a global button rule (`.ripple-host` in `app/globals.css`) overrode the X's position. It now lives in `@layer components`, so the X goes back to the top right. This also fixes any other button positioned with `absolute`.
- **Two dialogs at once:** "What's new" no longer opens on top of the welcome card (`components/shell/WhatsNew.tsx`). It waits until the welcome card is closed.

## 5. Your data downloads as a PDF

Settings > Your data now downloads a readable PDF: cover, contents summary, then Profile, Connected accounts, Posts, Uploads, Ideas, Saved snippets, Subscriptions, Invoices and Direct messages, with page numbers and dates in the user's time zone. No tokens or passwords are included.

JSON is still available through the link "Or as JSON, for moving to another app" (`/api/settings/export?format=json`).

Files: `lib/export-pdf.ts` (new, no extra packages), `app/api/settings/export/route.ts`, `components/settings/YourDataCard.tsx`, `app/(marketing)/privacy/page.tsx`. Limit: 6 downloads per hour.

## Fixes from the independent code review

An independent review found no blockers. Fixed:
- The webhook handles at most 200 events per call and looks up at most 5 new people's profiles, so a burst of messages can't push it past Meta's 20 second limit. Names it skipped are filled in on the next sync.
- "Refresh" in Messages (`?sync=1`) has its own limit of 6 a minute, because each sync calls Meta for every account. Past that, the list is served from what is already stored.
- Unticked Instagram messages permission is now reported (see section 2).
- Editors see a short read-only note instead of a reply box they can't use.
- Attachment links in messages open only if they are https.
- The export route is marked dynamic, so it is never cached.

## Tests added

- `tests/round-1031-dms.test.ts` (30)
- `tests/round-1031b-instagram-connect.test.ts` (15)
- `tests/round-1031c-export-pdf.test.ts` (4)
- `tests/round-1031d-review.test.ts` (6)
