import { humanError, PLATFORM_META, type Platform } from "@/lib/domain";

/**
 * Friendly copy for the codes the platform layer added after humanError() was written.
 * Everything else falls through to the shared map, and the raw code/detail stays on screen.
 */
export function targetErrorCopy(platform: Platform, code: string | null | undefined): ReturnType<typeof humanError> {
  const name = PLATFORM_META[platform].name;
  switch (code) {
    case "FORBIDDEN":
      return { title: `${name} wouldn't allow this one: the account doesn't have permission for it yet.`, action: "Let's try again", kind: "retry" as const };
    case "NEEDS_APPROVAL":
      return { title: "Waiting on a teammate's approval before this goes out.", action: "Open the review", kind: "retry" as const };
    case "DUPLICATE":
      return { title: `${name} already has this one, so we didn't post it twice.`, action: "Send it anyway", kind: "retry" as const };
    default:
      return humanError(platform, code);
  }
}
