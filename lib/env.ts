import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3040"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  TOKEN_ENCRYPTION_KEY: z.string().min(40, "TOKEN_ENCRYPTION_KEY must be a base64 32-byte key"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional().default(""),
  STORAGE_DRIVER: z.enum(["local", "s3", "supabase"]).default("local"),
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
  X_CLIENT_ID: z.string().optional().default(""),
  X_CLIENT_SECRET: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
