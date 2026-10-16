import { z } from "zod";
import { PLATFORMS } from "./domain";

export const platformSchema = z.enum(PLATFORMS);

export const signupSchema = z.object({
  name: z.string().trim().min(1, "What should we call you?").max(80),
  email: z.string().trim().toLowerCase().email("That email doesn't look quite right"),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("That email doesn't look quite right"),
  password: z.string().min(1, "Password, please").max(200),
});

export const mediaMetaSchema = z.object({
  duration: z.number().nonnegative().max(60 * 60 * 3).optional(),
  width: z.number().int().positive().max(16384).optional(),
  height: z.number().int().positive().max(16384).optional(),
});

/** A text field that also accepts a list of strings (joined with spaces), so a stray array from AI copy never blocks a save. */
const textish = (max: number) =>
  z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" || typeof x === "number").join(" ") : v), z.string().max(max).optional().nullable());

export const targetDraftSchema = z.object({
  platform: platformSchema,
  title: textish(200),
  caption: textish(5000),
  description: textish(5000),
  hashtags: textish(1000),
});

export const savePostSchema = z.object({
  postId: z.string().cuid().optional(),
  mediaId: z.string().cuid(),
  title: z.string().max(200).optional().nullable(),
  story: z.string().max(4000).optional().nullable(),
  hook: z.string().max(500).optional().nullable(),
  targets: z.array(targetDraftSchema).max(PLATFORMS.length),
});

export const launchSchema = z.object({
  mode: z.enum(["now", "schedule"]),
  scheduledAt: z.string().datetime().optional(),
  confirmed: z.literal(true, { errorMap: () => ({ message: "Please review the content before sending." }) }),
});

export const updatePostSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  targets: z.array(targetDraftSchema).optional(),
  title: z.string().max(200).optional(),
  requireApproval: z.boolean().optional(),
});

export const reviewDecisionSchema = z
  .object({
    reviewerName: z.string().trim().min(1, "Please add your name so they know who looked.").max(80),
    decision: z.enum(["approved", "changes_requested"]),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision !== "changes_requested" || !!v.note, { message: "Tell them what to change.", path: ["note"] });

export const inboxReplySchema = z.object({
  // A published Outlly target (cuid) or a post on the creator's own account (a:<accountId>:<mediaId>).
  targetId: z.string().refine((v) => /^c[a-z0-9]{20,}$/.test(v) || /^a:c[a-z0-9]{20,}:[\w.-]{1,120}$/.test(v), "Unknown post"),
  commentId: z.string().min(1).max(200),
  text: z.string().trim().min(1, "Write something first.").max(1000),
});

export const hookRequestSchema = z.object({
  story: z.string().trim().min(3, "Tell me a little more about it").max(4000),
  tone: z.enum(["default", "punchier", "professional", "genz"]).default("default"),
  exclude: z.array(z.string().max(500)).max(30).default([]),
});

export const platformCopyRequestSchema = z.object({
  story: z.string().trim().min(3).max(4000),
  hook: z.string().trim().min(3).max(500),
  platforms: z.array(platformSchema).min(1),
});

export const replySuggestRequestSchema = z.object({
  comment: z.string().trim().min(1).max(2000),
  author: z.string().trim().max(120).default(""),
  platform: platformSchema,
  postTitle: z.string().max(300).nullish(),
});
