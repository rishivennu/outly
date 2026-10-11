/**
 * Dashboard copy-paste often brings a trailing newline or space along with a value
 * (Vercel keeps it verbatim). That silently breaks URLs and database strings, so every
 * setting is trimmed once, before Prisma or the env schema reads it. APP_URL also loses
 * any trailing slash, so links never come out as "//api".
 */
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string" && v !== v.trim()) process.env[k] = v.trim();
}
if (process.env.APP_URL) process.env.APP_URL = process.env.APP_URL.replace(/\/+$/, "");
export {};
