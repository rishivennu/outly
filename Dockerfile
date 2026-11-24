# Outlly on Render (R1312). One image, same behaviour as the Vercel deploy: the same `next build`, the same Prisma
# client against the same Postgres, the same four crons (scripts/cron-scheduler.mjs replays vercel.json against this
# process with CRON_SECRET), the same env names. Build and run from one Debian image so Prisma's engines match.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PROVIDER=postgresql \
    PORT=10000

# openssl: Prisma engines. ffmpeg/ffprobe: lib/media/probe.ts uses them when present (Vercel had none; same code, more
# capable). ca-certificates: outbound HTTPS to the social APIs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g bun@1.3

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Render passes the service's environment variables to the build. The blog and workshops pages are ISR (revalidate),
# so `next build` prerenders them against the live database exactly as the Vercel build did.
ARG DATABASE_URL
ARG DIRECT_URL
ARG DATABASE_PROVIDER=postgresql
ARG RENDER_GIT_COMMIT
ENV DATABASE_PROVIDER=${DATABASE_PROVIDER} \
    NEXT_PUBLIC_BUILD=${RENDER_GIT_COMMIT}

RUN bun scripts/prisma-provider.mjs \
  && bunx prisma generate \
  && if [ "$DATABASE_PROVIDER" = "sqlite" ]; then bunx prisma db push --skip-generate; fi \
  && bunx next build

EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["sh", "scripts/render-start.sh"]
