// Writes prisma/schema.prisma from the template using DATABASE_PROVIDER (sqlite | postgresql).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");
let provider = process.env.DATABASE_PROVIDER;
if (!provider && existsSync(envPath)) {
  const m = readFileSync(envPath, "utf8").match(/^DATABASE_PROVIDER=(\w+)/m);
  provider = m?.[1];
}
provider = provider || "sqlite";
if (!["sqlite", "postgresql"].includes(provider)) throw new Error(`Unsupported DATABASE_PROVIDER: ${provider}`);
const tpl = readFileSync(resolve(root, "prisma/schema.template.prisma"), "utf8");
const direct = provider === "postgresql" ? 'directUrl = env("DIRECT_URL")' : "";
writeFileSync(resolve(root, "prisma/schema.prisma"), tpl.replace("__PROVIDER__", provider).replace("__DIRECT_URL__", direct));
console.log(`prisma/schema.prisma written for provider: ${provider}`);
