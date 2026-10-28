Outlly: files missing or outdated on github.com/rishivennu/outly (checked 2026-10-28)
Upload each file to the same path in the repo (overwrite existing ones).

NEW (not in the repo at all), the 1036 Founding Member feature:
  app/admin/(panel)/founding/page.tsx
  app/api/admin/founding/route.ts
  app/api/founding/route.ts
  app/api/founding/seats/route.ts
  app/api/founding/verify/route.ts
  components/admin/FoundingPanel.tsx
  components/founding/FoundingCard.tsx
  components/founding/FoundingSeats.tsx
  components/founding/FoundingStamp.tsx
  lib/founding-config.ts
  lib/founding.ts
  public/brand/founding/01-rocket-badge.png
  public/brand/founding/02-wordmark-pill.png
  public/brand/founding/03-app-tile.png
  public/brand/founding/04-rocket-flower.png
  public/brand/founding/05-outlly-ring.png
  tests/founding.test.ts

OUTDATED in the repo (local copy is newer):
  app/(auth)/signup/page.tsx
  app/api/files/[...key]/route.ts
  components/admin/AdminShell.tsx
  components/auth/AuthForm.tsx
  components/shared/Watermark.tsx
  lib/auth-provider.ts
  lib/billing/service.ts
  lib/email/index.ts
  lib/otp/service.ts
  lib/settings.ts

After upload: run `npx prisma db push` against prod (1036 adds 7 User columns).
vercel.json differs only in line endings: no action needed.
