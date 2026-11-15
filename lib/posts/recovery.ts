import { PLATFORM_META, isPlatform } from "../domain";

/**
 * What the calendar can offer on a destination that didn't go out, per error code (lib/domain.ts ErrorCode).
 * Pure and client-safe. Each kind maps to something that already exists:
 * - reconnect: the Accounts page (href /accounts). A token that expired or lost a permission comes back there.
 * - retry: POST /api/targets/[targetId]/retry (retryTarget), the same destination sent again.
 * - edit: the post in Create (href /create?post=<id> when postId is given), for something the platform refused.
 * - reschedule: pick a new time (the calendar's move dialog, PATCH /api/posts/[id] scheduledAt).
 * Nothing here is offered for a destination that is not "failed".
 */
export type RecoveryAction = { kind: "reconnect" | "retry" | "edit" | "reschedule"; label: string; href?: string };

export function recoveryActions(t: { platform: string; status: string; errorCode: string | null; postId?: string }): RecoveryAction[] {
  if (t.status !== "failed") return [];
  const name = isPlatform(t.platform) ? PLATFORM_META[t.platform].name : "the account";
  const reconnect: RecoveryAction = { kind: "reconnect", label: `Reconnect ${name}`, href: "/accounts" };
  const retry = (label = "Retry now"): RecoveryAction => ({ kind: "retry", label });
  const edit = (label = "Edit and retry"): RecoveryAction => ({ kind: "edit", label, ...(t.postId ? { href: `/create?post=${encodeURIComponent(t.postId)}` } : {}) });
  const reschedule: RecoveryAction = { kind: "reschedule", label: "Pick a new time" };
  switch (t.errorCode) {
    case "AUTH_EXPIRED":
    case "NOT_CONNECTED":
    case "FORBIDDEN":
      // retryTarget refuses until the account is connected again, so reconnect comes first.
      return [reconnect, retry("Retry after reconnecting")];
    case "MEDIA_REJECTED":
      // The same file would be refused again: change it first.
      return [edit("Edit and retry")];
    case "RATE_LIMITED":
      return [reschedule, retry("Try again")];
    case "NETWORK":
    case "PLATFORM_DOWN":
      return [retry(), reschedule];
    case "DUPLICATE":
      return [edit("Change it and retry"), retry("Send it anyway")];
    case "NEEDS_APPROVAL":
      return [edit("Open the review")];
    case "CANCELED":
      return [retry("Send it again"), reschedule];
    default:
      return [retry(), edit()];
  }
}
