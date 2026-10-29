import "server-only";
import "./env-clean";
import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient };
/**
 * Serverless pool (1040): the deploy guide said `connection_limit=1`, so every query in an instance queued
 * behind one connection and a slow one made the rest give up after Prisma's 10 s wait. On Vercel, allow 3
 * (Supabase's pooler takes hundreds of clients) and wait up to 20 s. Only raises values, never lowers them.
 */
function poolUrl(raw = process.env.DATABASE_URL ?? "") {
  if (!process.env.VERCEL || !/^postgres(ql)?:/.test(raw)) return undefined;
  try {
    const u = new URL(raw);
    const at = (k: string, min: number) => {
      const n = Number(u.searchParams.get(k));
      if (!Number.isFinite(n) || n < min) u.searchParams.set(k, String(min));
    };
    at("connection_limit", 3);
    at("pool_timeout", 20);
    return u.toString();
  } catch {
    return undefined;
  }
}
const url = poolUrl();
export const db = g.__prisma ?? new PrismaClient({ log: ["warn", "error"], ...(url ? { datasources: { db: { url } } } : {}) });
if (process.env.NODE_ENV !== "production") g.__prisma = db;
