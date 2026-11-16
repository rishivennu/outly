# Sign in with Apple: setup (round 1153)

The code is in place: `lib/apple-auth.ts`, `app/api/auth/apple/route.ts`, `app/api/auth/apple/callback/route.ts`,
`components/auth/AppleButton.tsx`, `signInWithApple` in `lib/auth-provider.ts` and `User.appleSub`. The Apple
button appears on /login and /signup only when all four `APPLE_` variables are set and the key parses.

You need an Apple Developer Program membership (99 USD a year) and the Account Holder or Admin role.
Everything below is at https://developer.apple.com/account/resources.

## 1. App ID (once)
Identifiers > + > App IDs > App. Description `Outlly`, Bundle ID (explicit) `com.outlly.app`.
Under Capabilities tick **Sign In with Apple**. Continue > Register.

## 2. Services ID (this is the web "client ID")
Identifiers > + > Services IDs. Description `Outlly` (people see this name on Apple's sign-in sheet),
Identifier `com.outlly.web`. Continue > Register.
Open it again, tick **Sign In with Apple** > Configure:
- Primary App ID: `com.outlly.app`
- Domains and Subdomains: `www.outlly.com,outlly.com`
- Return URLs: `https://www.outlly.com/api/auth/apple/callback` (exactly this; APP_URL is the www host)
Next > Done > Continue > Save.

## 3. Key
Keys > +. Name `Outlly Sign in with Apple`, tick **Sign in with Apple** > Configure > Primary App ID
`com.outlly.app` > Save > Continue > Register. **Download `AuthKey_XXXXXXXXXX.p8`** (Apple lets you download it
once). Note the 10-character Key ID.

## 4. Team ID
Top right of the developer site, or Membership details. 10 characters.

## 5. Emails to Hide My Email addresses
People who pick Hide My Email get an `@privaterelay.appleid.com` address. Apple only forwards mail from senders
you register: Services > Sign in with Apple for Email Communication > Configure > + and add the domain
`mail.outlly.com` (Resend already signs it with SPF and DKIM). Without this, sign-in codes and reports to those
users bounce.

## 6. Vercel
Project > Settings > Environment Variables, Production:

| Name | Value |
| --- | --- |
| `APPLE_CLIENT_ID` | `com.outlly.web` (the Services ID, not the App ID) |
| `APPLE_TEAM_ID` | your Team ID |
| `APPLE_KEY_ID` | the Key ID |
| `APPLE_PRIVATE_KEY` | the whole .p8 file, BEGIN and END lines included |

Mark `APPLE_PRIVATE_KEY` as Sensitive. Redeploy. The build adds the `appleSub` column to the database itself
(scripts/db-sync.mjs).

## 7. Test
Open https://www.outlly.com/login in a private window: the black **Sign in with Apple** button sits above Google.
Sign up once from /signup (tick 18+ first), then sign out and sign in again.
Apple does not allow localhost return URLs, so this cannot be tried on a local server.

## When it fails, the login page says why
| Message mentions | Fix |
| --- | --- |
| keys (Services ID, Team ID, Key ID or private key) | `invalid_client`: APPLE_CLIENT_ID is the App ID instead of the Services ID, or the key belongs to another team |
| Apple page shows "invalid_request, Invalid web redirect url" | the Return URL in step 2 is not exactly the one above |
| no Apple button at all | one of the four variables is empty, or the key is not the .p8 contents |
| took too long or another tab | started on one host and finished on another, or over 10 minutes |

## Notes
- The client secret is signed fresh for each sign-in, so there is no six-month rotation to remember.
- An existing Outlly account with the same verified email is linked, not duplicated. After that Apple's stable
  ID is the key, so a changed Apple email still finds the account.
- If an iOS app ever ships with Google sign-in, App Store rule 4.8 needs Sign in with Apple in the app too.
  A native app signs in with the App ID as audience, which this web flow does not accept yet.
