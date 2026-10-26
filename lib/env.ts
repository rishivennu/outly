import "server-only";
import "./env-clean";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3040"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  TOKEN_ENCRYPTION_KEY: z.string().min(40, "TOKEN_ENCRYPTION_KEY must be a base64 32-byte key"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional().default(""),
  STORAGE_DRIVER: z.enum(["local", "s3", "r2", "supabase"]).default("local"),
  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_SECRET_KEY: z.string().optional().default(""),
  SUPABASE_BUCKET: z.string().optional().default("media"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().default(""),
  AUTH_PROVIDER: z.enum(["local", "supabase"]).default("local"),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_REGION: z.string().optional().default("auto"),
  S3_BUCKET: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  /** Cloudflare R2 (STORAGE_DRIVER=r2). Endpoint is derived from the account id; R2_ENDPOINT overrides it (e.g. EU jurisdiction). */
  R2_ACCOUNT_ID: z.string().optional().default(""),
  R2_ACCESS_KEY_ID: z.string().optional().default(""),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(""),
  R2_BUCKET: z.string().optional().default("outlly-media"),
  R2_ENDPOINT: z.string().optional().default(""),
  /** Part size for browser multipart uploads to R2/S3 (min 5 MB; R2 needs equal parts). */
  /** Pin each presigned upload URL to its exact Content-Length (default on). Turn off only if the bucket rejects signed lengths. */
  UPLOAD_PIN_LENGTH: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  UPLOAD_PART_MB: z.coerce.number().int().min(5).max(100).default(10),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(4096).default(500),
  FFMPEG_PATH: z.string().optional().default(""),
  FFPROBE_PATH: z.string().optional().default(""),
  MOCK_SOCIAL_PUBLISHING: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.15),
  INSTAGRAM_CLIENT_ID: z.string().optional().default(""),
  INSTAGRAM_CLIENT_SECRET: z.string().optional().default(""),
  YOUTUBE_CLIENT_ID: z.string().optional().default(""),
  YOUTUBE_CLIENT_SECRET: z.string().optional().default(""),
  // Fallbacks for the other platforms; Admin > Social platforms wins field by field.
  FACEBOOK_CLIENT_ID: z.string().optional().default(""), // Meta App ID
  FACEBOOK_CLIENT_SECRET: z.string().optional().default(""),
  THREADS_CLIENT_ID: z.string().optional().default(""), // Threads app ID (Use cases > Threads API)
  THREADS_CLIENT_SECRET: z.string().optional().default(""),
  LINKEDIN_CLIENT_ID: z.string().optional().default(""),
  LINKEDIN_CLIENT_SECRET: z.string().optional().default(""),
  TIKTOK_CLIENT_ID: z.string().optional().default(""), // TikTok "Client key"
  TIKTOK_CLIENT_SECRET: z.string().optional().default(""),
  X_CLIENT_ID: z.string().optional().default(""),
  X_CLIENT_SECRET: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),
  /* Optional FunASR (Paraformer) subtitle worker, the speech engine FunClip uses. POST audio/wav, returns FunASR JSON. */
  FUNASR_URL: z.string().optional().default(""),
  FUNASR_TOKEN: z.string().optional().default(""),
  /** Bearer secret for /api/cron/* (Vercel Cron sends it automatically when set). */
  CRON_SECRET: z.string().optional().default(""),
  /** Upstash Redis REST, so rate limits are shared across serverless instances instead of per-process. */
  UPSTASH_REDIS_REST_URL: z.string().optional().default(""),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().default(""),
  /** AI calls one creator may make per UTC day (app/api/ai/*), and separately in support chat. */
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(60),
  AI_SUPPORT_DAILY_LIMIT: z.coerce.number().int().min(0).default(40),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
