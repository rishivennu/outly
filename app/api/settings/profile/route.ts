import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { isOrbValue } from "@/lib/avatar";
import { PLATFORMS } from "@/lib/domain";
import { BIO_MAX, NICHE_MAX, cleanLink, cleanText, handleProblem, normalizeHandle, parseProfileLinks } from "@/lib/profile-card-core";

const schema = z.object({
  name: z.string().trim().min(1, "What should we call you?").max(80).optional(),
  timezone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "That time zone doesn't look right")
    .optional(),
  weeklyReport: z.boolean().optional(),
  // Only orb values can be set here; photos come from sign-in providers or the cropper upload (./image), never a typed URL.
  avatar: z.string().refine(isOrbValue, "Pick one of the orbs").nullable().optional(),
  postingGoal: z.number().int().min(0).max(21).optional(),
  // 1120: the creator profile card. Empty strings clear a field.
  handle: z
    .string()
    .max(64)
    .transform(normalizeHandle)
    .superRefine((h, ctx) => {
      const problem = h ? handleProblem(h) : null;
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    })
    .nullable()
    .optional(),
  bio: z.string().max(BIO_MAX * 2).transform((s) => cleanText(s, BIO_MAX, true)).nullable().optional(),
  niche: z.string().max(NICHE_MAX * 2).transform((s) => cleanText(s, NICHE_MAX)).nullable().optional(),
  profileLinks: z
    .object({
      hidden: z.array(z.string().max(64)).max(40),
      links: z.array(z.object({ platform: z.enum(PLATFORMS), url: z.string().max(300) })).max(PLATFORMS.length),
    })
    .optional(),
});

export const PATCH = route(async (req, { user }) => {
  const body = schema.parse(await req.json());
  const { profileLinks, handle, bio, niche, ...rest } = body;
  const data: Prisma.UserUpdateInput = { ...rest };
  if (handle !== undefined) data.handle = handle || null;
  if (bio !== undefined) data.bio = bio || null;
  if (niche !== undefined) data.niche = niche || null;
  if (profileLinks) {
    const bad = profileLinks.links.find((l) => l.url.trim() && !cleanLink(l.platform, l.url));
    if (bad) throw new HttpError(422, `That ${bad.platform === "x" ? "X" : bad.platform[0].toUpperCase() + bad.platform.slice(1)} link isn't a public profile address.`, "BAD_LINK", { platform: bad.platform });
    // Stored through the same parser that reads it, so only clean links and one per platform are ever kept.
    const clean = parseProfileLinks(JSON.stringify({ hidden: profileLinks.hidden, links: profileLinks.links.filter((l) => l.url.trim()) }));
    data.profileLinks = JSON.stringify(clean);
  }
  if ((handle !== undefined || bio !== undefined || niche !== undefined || profileLinks) && user.actor) throw new HttpError(403, "Only the studio owner can change the profile card.", "NOT_OWNER");
  try {
    const u = await db.user.update({ where: { id: user.id }, data, select: { name: true, timezone: true, weeklyReport: true, avatar: true, postingGoal: true, handle: true, bio: true, niche: true, profileLinks: true } });
    return json({ user: u });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "That handle is taken. Try another.", "HANDLE_TAKEN");
    throw e;
  }
});
