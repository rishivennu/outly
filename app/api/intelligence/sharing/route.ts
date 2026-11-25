import { z } from "zod";
import { json, route, HttpError } from "@/lib/http";
import { SHARED_MIN_OWNERS, SHARED_MIN_POSTS, SHARED_WINDOW_DAYS } from "@/lib/intelligence/shared-core";
import { CONSENT_SOURCES, consentView, type ConsentSource, type ConsentState } from "@/lib/intelligence/consent-core";
import { consentHistory, currentConsent, grantConsent, requestDeletion, withdrawConsent } from "@/lib/intelligence/consent";
import { myContribution } from "@/lib/intelligence/shared-lineage";

export const dynamic = "force-dynamic";

/**
 * R1324 → R1335: the "Help improve Outlly AI" consent. GET reads the current state, the copy the user agreed to (title,
 * explanation, categories, what is never included) and the decision history; PATCH records a decision. Never
 * preselected: a user with no decision reads `state.granted: false`. The posts belong to the workspace owner, so the
 * decision is theirs: a team member reads it but cannot change it (`canChange`). Open to every plan; nothing here reads
 * entitlements (consent and the Personal Intelligence perk are separate, lib/intelligence/entitlements-core.ts).
 *
 * PATCH body: { action: "grant" | "withdraw" | "request-deletion", source? } or the R1324 shape { share: boolean }.
 * Withdrawal takes effect at the next hourly rebuild; a deletion request makes the next sweep tick rebuild at once and
 * is marked done when it has (R1336 also purges the contribution lineage rows).
 */
const body = z.union([
  z.object({ action: z.enum(["grant", "withdraw", "request-deletion"]), source: z.enum(CONSENT_SOURCES as [ConsentSource, ...ConsentSource[]]).optional() }),
  z.object({ share: z.boolean(), source: z.enum(CONSENT_SOURCES as [ConsentSource, ...ConsentSource[]]).optional() }),
]);

const rules = { minOwners: SHARED_MIN_OWNERS, minPosts: SHARED_MIN_POSTS, windowDays: SHARED_WINDOW_DAYS };

async function view(userId: string, state: ConsentState, canChange: boolean) {
  const history = (await consentHistory(userId, 10)).map((h) => ({
    status: h.status,
    policyVersion: h.policyVersion,
    source: h.source,
    at: new Date(h.createdAt).toISOString(),
    deletion: h.deletionStatus ? { status: h.deletionStatus, requestedAt: h.deletionRequestedAt ? new Date(h.deletionRequestedAt).toISOString() : null, doneAt: h.deletionDoneAt ? new Date(h.deletionDoneAt).toISOString() : null } : null,
  }));
  // R1336: the creator's own lineage (counts and dates only). `share` kept for anything still reading the R1324 shape.
  const contribution = await myContribution(userId);
  return { ...consentView(state), share: state.granted, canChange, rules, history, contribution };
}

export const GET = route(
  async (_req, { user }) => {
    const state = await currentConsent(user.id);
    return json(await view(user.id, state, user.role === "owner"), { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);

export const PATCH = route(
  async (req, { user }) => {
    if (user.role !== "owner") throw new HttpError(403, "Only the workspace owner can change this.", "OWNER_ONLY");
    const b = body.parse(await req.json());
    const source: ConsentSource = b.source ?? "settings";
    const action = "action" in b ? b.action : b.share ? "grant" : "withdraw";
    const state =
      action === "grant" ? await grantConsent(user.id, { source }) : action === "withdraw" ? await withdrawConsent(user.id, { source }) : await requestDeletion(user.id, { source });
    return json(await view(user.id, state, true));
  },
  { limit: [20, 60_000] },
);
