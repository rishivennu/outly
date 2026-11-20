// R1235: the brand profile form rules, pure (zod + the objective table only) so the API route and the tests share them.
import { z } from "zod";
import { OBJECTIVES, OBJECTIVE_METRICS, type Objective } from "./core";

export const BRAND_LIMITS = { name: 60, audience: 300, tone: 120, listItems: 12, listItem: 40 } as const;

const OBJECTIVE_LABEL: Record<Objective, string> = {
  awareness: "Awareness",
  engagement: "Engagement",
  community: "Community",
  traffic: "Traffic",
  leads: "Leads",
  sales: "Sales",
};

export interface ObjectiveOption {
  id: Objective;
  label: string;
  reason: string;
  proxy: boolean;
}

export function objectiveOptions(): ObjectiveOption[] {
  return OBJECTIVES.map((id) => ({ id, label: OBJECTIVE_LABEL[id], reason: OBJECTIVE_METRICS[id].reason, proxy: OBJECTIVE_METRICS[id].proxy }));
}

const optionalText = (max: number, what: string) => z.string().trim().max(max, `${what} can be at most ${max} characters.`).nullable().optional();
const chipList = (what: string) =>
  z
    .array(z.string().trim().min(1, `${what} can't be empty.`).max(BRAND_LIMITS.listItem, `Each of ${what.toLowerCase()} can be at most ${BRAND_LIMITS.listItem} characters.`))
    .max(BRAND_LIMITS.listItems, `${what}: at most ${BRAND_LIMITS.listItems}.`)
    .optional();

/* R1246: agency clients. A client is a brand profile with its own scopeKey and the owner's accounts it covers. */

export const CLIENTS_MAX = 20;
export const CLIENT_ACCOUNTS_MAX = 50;
export const SCOPE_KEY_MAX = 40;
const SCOPE_KEY_RE = /^[a-z0-9-]{1,40}$/;
// A SocialAccount id is a cuid; anything with other characters is not one of ours and is refused before any query.
const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const isScopeKey = (k: unknown): k is string => typeof k === "string" && SCOPE_KEY_RE.test(k);

/** A client key from its name: "Zeta Foods & Co." -> "zeta-foods-co". Never empty, so a name of only symbols still gets a key. */
export function slugOf(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SCOPE_KEY_MAX)
    .replace(/-+$/g, "");
  return slug || "client";
}

const accountIdList = z.preprocess(
  (v) => (Array.isArray(v) ? [...new Set(v.map((x) => (typeof x === "string" ? x.trim() : x)))] : v),
  z
    .array(z.string().regex(ACCOUNT_ID_RE, "That is not an account id."))
    .max(CLIENT_ACCOUNTS_MAX, `A client can have at most ${CLIENT_ACCOUNTS_MAX} accounts.`),
);

export const brandProfileSchema = z
  .object({
    objective: z.enum(OBJECTIVES as unknown as [Objective, ...Objective[]], { message: "Choose an objective: awareness, engagement, community, traffic, leads or sales." }),
    name: optionalText(BRAND_LIMITS.name, "The brand name"),
    audience: optionalText(BRAND_LIMITS.audience, "The audience"),
    tone: optionalText(BRAND_LIMITS.tone, "The tone"),
    pillars: chipList("Content pillars"),
    avoid: chipList("Things to avoid"),
    // R1246: client fields. scopeKey "" (or left out) is your own brand; `client: true` asks for a new client.
    scopeKey: z
      .string()
      .trim()
      .refine((k) => k === "" || isScopeKey(k), `A client key is 1 to ${SCOPE_KEY_MAX} characters: lowercase letters, digits and dashes.`)
      .optional(),
    client: z.boolean().optional(),
    accountIds: accountIdList.optional(),
  })
  .superRefine((b, ctx) => {
    const isClient = b.client === true || (b.scopeKey !== undefined && b.scopeKey !== "");
    if (isClient && !b.name) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "Give the client a name." });
  });
export type BrandProfileBody = z.infer<typeof brandProfileSchema>;

/** The body rules for one scope: a client ("" is your own brand) always needs a name. */
export const parseBrandBody = (raw: unknown, scopeKey: string): BrandProfileBody =>
  brandProfileSchema.parse(scopeKey && raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw, scopeKey } : raw);
