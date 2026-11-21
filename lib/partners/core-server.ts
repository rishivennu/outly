import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";
import { storage } from "../storage";
import { env } from "../env";
import { OPEN_STATUSES, PARTNER_TERMS_VERSION, canTransition, type PartnerStatus } from "./types";
import { FILE_EXT, cleanFileName, emailKeyOf, makeRef, pendingFileKey, summarise } from "./core";
import type { Application } from "./schema";
import { isProven } from "../founding";
import { partnerNotice } from "./notices";

const DAY = 86_400_000;
/** A rejected or withdrawn application blocks a new one for this long; an open one blocks it until it closes. */
export const REAPPLY_DAYS = 90;

export const ipHashOf = (ip: string) => createHash("sha256").update(ip + env.AUTH_SECRET).digest("hex").slice(0, 24);

export async function findDuplicate(emailKey: string, now = new Date()) {
  return db.partnerApplication.findFirst({
    where: {
      emailKey,
      OR: [{ status: { in: OPEN_STATUSES } }, { status: { in: ["rejected", "withdrawn"] }, createdAt: { gte: new Date(now.getTime() - REAPPLY_DAYS * DAY) } }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, ref: true, status: true },
  });
}

/** Upload tokens -> stored pending files. A token whose object is missing is dropped (it expired or never finished). */
export async function resolveFiles(files: Application["files"]) {
  const out: { key: string; name: string; mime: string; size: number }[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.token)) continue;
    seen.add(f.token);
    for (const [mime, ext] of Object.entries(FILE_EXT)) {
      const key = pendingFileKey(f.token, ext);
      const st = await storage.stat(key).catch(() => null);
      if (st) {
        out.push({ key, name: cleanFileName(f.name || `analytics.${ext}`), mime, size: st.size });
        break;
      }
    }
  }
  return out;
}

/** `ctx.userId` is the signed-in applicant; otherwise the account whose PROVEN email matches, so nobody can claim a stranger's application by signing up first. */
export async function createApplication(input: Application, ctx: { ip: string; userId?: string | null }) {
  const { personal, socials, stats, proposal } = input;
  const emailKey = emailKeyOf(personal.email);
  const sum = summarise({ socials, stats, proposal });
  const match = ctx.userId ? null : await db.user.findUnique({ where: { email: personal.email }, select: { id: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true } }).catch(() => null);
  const userId = ctx.userId || (match && isProven(match) ? match.id : null);
  const files = await resolveFiles(input.files);
  const already = files.length ? await db.partnerFile.findMany({ where: { key: { in: files.map((f) => f.key) } }, select: { key: true } }) : [];
  const fresh = files.filter((f) => !already.some((a) => a.key === f.key));

  for (let attempt = 0; ; attempt++) {
    try {
      const app = await db.partnerApplication.create({
        data: {
          ref: makeRef(),
          status: "submitted",
          fullName: personal.fullName,
          email: personal.email,
          emailKey,
          country: personal.country,
          city: personal.city,
          phone: personal.phone,
          brandName: personal.brandName,
          userId,
          socials: JSON.stringify(socials),
          stats: JSON.stringify(stats),
          proposal: JSON.stringify(proposal),
          ...sum,
          consentAt: new Date(),
          termsVersion: PARTNER_TERMS_VERSION,
          ipHash: ipHashOf(ctx.ip),
          source: input.source,
          files: { create: fresh },
          events: { create: { actor: "creator", action: "application.submit", to: "submitted", meta: JSON.stringify({ files: fresh.length, source: input.source }) } },
        },
      });
      await partnerNotice(app, "received", { stamp: app.id });
      return app;
    } catch (e) {
      const unique = (e as { code?: string }).code === "P2002" && String((e as { meta?: { target?: unknown } }).meta?.target ?? "").includes("ref");
      if (!unique || attempt >= 4) throw e;
    }
  }
}

export type WithdrawResult = { ok: true; app: Awaited<ReturnType<typeof db.partnerApplication.update>> } | { ok: false; reason: "not_found" | "closed" };

/** Ref and email must both match; a mismatch reads exactly like a missing ID so nobody can probe for applications. */
export async function withdrawApplication(ref: string, email: string): Promise<WithdrawResult> {
  const app = await db.partnerApplication.findUnique({ where: { ref } });
  if (!app || app.emailKey !== emailKeyOf(email)) return { ok: false, reason: "not_found" };
  const from = app.status as PartnerStatus;
  if (!OPEN_STATUSES.includes(from) || !canTransition(from, "withdrawn")) return { ok: false, reason: "closed" };
  const updated = await db.partnerApplication.update({
    where: { id: app.id },
    data: { status: "withdrawn", withdrawnAt: new Date(), events: { create: { actor: "creator", action: "status.change", from, to: "withdrawn", meta: "{}" } } },
  });
  return { ok: true, app: updated };
}
