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
  /** Pin each presigned upload URL to its exact Content-Length (default on). Turn off only if the bucket rejects signed lengths. */
  UPLOAD_PIN_LENGTH: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  /**
   * Part size for browser multipart uploads to R2/S3, in MB. R2 needs every part but the last the same size and at
   * least 5 MiB, and at most 10,000 parts, so a file too big for this size gets a bigger one (lib/storage partSizeFor).
   * R1193: 16 MB by default (was 10): fewer requests per GB, and a lost part costs seconds even on 4G.
   */
  UPLOAD_PART_MB: z.coerce.number().int().min(5).max(100).default(16),
  /** R1193: how long a presigned part or file URL stays valid, in seconds. The browser signs again when one runs out. */
  UPLOAD_URL_TTL_SEC: z.coerce.number().int().min(60).max(21_600).default(900),
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
  /** Webhook verify token for Meta (Instagram + Page messages). Empty = derived from AUTH_SECRET; shown in Admin > Social platforms. */
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),
  YOUTUBE_CLIENT_ID: z.string().optional().default(""),
  YOUTUBE_CLIENT_SECRET: z.string().optional().default(""),
  /** Sign in with Apple (1153). All four or the button stays hidden. CLIENT_ID is the Services ID (e.g. com.outlly.web), not the App ID. */
  APPLE_CLIENT_ID: z.string().optional().default(""),
  APPLE_TEAM_ID: z.string().optional().default(""),
  APPLE_KEY_ID: z.string().optional().default(""),
  /** The AuthKey_XXXX.p8 file's contents (as is, one line with \\n, or base64). Server only. */
  APPLE_PRIVATE_KEY: z.string().optional().default(""),
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
  /** Moonshot (Kimi) key: a second AI provider, raced against Gemini when Gemini is slow or failing. Empty = Gemini only. */
  KIMI_API_KEY: z.string().optional().default(""),
  /** NVIDIA NIM key (R1177): the default text and vision provider for captions, hooks, highlights and the blog. Gemini and Kimi run behind it. */
  NVIDIA_API_KEY: z.string().optional().default(""),
  /** NIM model ids; change here or in the deployment, never in the callers. */
  NVIDIA_MODEL: z.string().optional().default("nvidia/nemotron-3-ultra-550b-a55b"),
  NVIDIA_FAST_MODEL: z.string().optional().default("nvidia/nemotron-3.5-lightning-30b-a3b"),
  NVIDIA_VISION_MODEL: z.string().optional().default("nvidia/nemotron-3.5-super-vl-120b-a12b"),
  /** Groq key (R1177): Whisper large-v3 transcription for video captions, 15-20x faster than Gemini on the same chunk. Gemini stays as the fallback. */
  GROQ_API_KEY: z.string().optional().default(""),
  GROQ_WHISPER_MODEL: z.string().optional().default("whisper-large-v3-turbo"),
  /** Firebase service account (JSON, or the same JSON base64-encoded) for Android app push. Empty = no push. */
  FCM_SERVICE_ACCOUNT: z.string().optional().default(""),
  /** Web Push (1118). Optional: without them the server makes a VAPID pair once and keeps it encrypted in Settings. */
  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  /** Contact the push services can reach (https URL or mailto:). Defaults to APP_URL. */
  VAPID_SUBJECT: z.string().optional().default(""),
  /* Optional FunASR (Paraformer) subtitle worker, the speech engine FunClip uses. POST audio/wav, returns FunASR JSON. */
  FUNASR_URL: z.string().optional().default(""),
  FUNASR_TOKEN: z.string().optional().default(""),
  /** Bearer secret for /api/cron/* (Vercel Cron sends it automatically when set). */
  CRON_SECRET: z.string().optional().default(""),
  /** IndexNow key (8-128 letters, digits, dashes). Set = publishing an article pings Bing and friends; the key is served at /api/indexnow-key. */
  INDEXNOW_KEY: z.string().optional().default(""),
  /** Upstash Redis REST, so rate limits are shared across serverless instances instead of per-process. */
  UPSTASH_REDIS_REST_URL: z.string().optional().default(""),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().default(""),
  /** AI calls one creator may make per UTC day (app/api/ai/*), and separately in support chat. */
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(60),
  AI_SUPPORT_DAILY_LIMIT: z.coerce.number().int().min(0).default(40),
  /** Help-chat model calls for signed-out visitors: per IP per day, and for all visitors together per day. 0 = no AI for visitors. */
  AI_SUPPORT_ANON_PER_IP: z.coerce.number().int().min(0).default(15),
  AI_SUPPORT_ANON_DAILY: z.coerce.number().int().min(0).default(300),
  /** PostHog (1149). Defaults live in lib/analytics/config.ts; these override them. The personal key is server only. */
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().optional(),
  POSTHOG_PERSONAL_API_KEY: z.string().optional().default(""),
  POSTHOG_PROJECT_ID: z.string().optional(),
  POSTHOG_APP_HOST: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
