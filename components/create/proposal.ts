import type { Draft } from "@/lib/client/checks";

/** Phase 3 (B2F): a Pip / AI suggestion for one platform. Never applied until the person accepts it.
 * `patch` is what would change; `why` is one short reason shown with it. */
export type Proposal = { patch: Partial<Draft>; why: string };

/** What the fields looked like before an accepted proposal, so "Revert" can put them back. */
export type Undo = Partial<Draft>;
