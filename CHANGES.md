# repo-sync-1027

Upload these 12 files to https://github.com/rishivennu/outly (branch main), keeping the folders. Afterwards the repo matches the tested local copy: 683 tests pass, type check clean, production build ok.

## 1. Instagram connect: show the real reason (new)

The live site runs the latest Instagram code, and the connect still fails at a step that Outlly could not name. These files make the Accounts page show which step failed and Instagram's own error text, in a red panel that stays on the page. Tokens and secrets are never shown (long token-like strings are replaced with [hidden]).

- `app/api/accounts/[platform]/callback/route.ts`, `lib/social/connect-reason.ts`, `components/settings/AccountsView.tsx`, `tests/round-1031e-connect-detail.test.ts`
- `lib/social/instagram.ts`: if Instagram refuses the optional profile fields (name, picture), it retries with only the ID and handle instead of failing.

After upload, connect Instagram once more and send the line from the red panel.

## 2. Older fixes that never reached the repo

These were in earlier bundles, but the repo still has the old versions:
- `public/sw.js`: handles "Share to Outlly" from the phone share sheet. The live manifest already offers sharing, but the old service worker could not receive it.
- `app/api/files/[...key]/route.ts`: uploaded files can never run scripts when opened directly, and video seeking to the end works ("bytes=-N" ranges).
- `components/shell/AvatarCursor.tsx`: cursor is your avatar only, no arrow (your 10-15 request).
- `tests/email-template.test.ts`: matches the current email design (the old test fails against the current templates).
- `tsconfig.json`: build folder list only.
- `.gitignore`: NEW and important now that the repo is public. Stops `.env`, databases and user uploads from ever being committed.
- `public/.well-known/assetlinks.json`: NEW. Lets the Android app open Outlly full screen without a browser bar. Public by design.

Hidden names: if the upload page skips `.gitignore` or the `.well-known` folder, use Add file > Create new file, type the path (`.gitignore` or `public/.well-known/assetlinks.json`) and paste the content.

## 3. Delete from the repo (stray files)

On GitHub open each file, click the three dots, then Delete file:
- `layout.tsx`, `robots.ts`, `sitemap.ts` at the repo ROOT (the real ones live in `app/`)
- `components/marketing/HeroStage.tsx` (no longer used, listed in DELETE.txt)
