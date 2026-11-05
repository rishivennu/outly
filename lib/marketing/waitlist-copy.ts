/**
 * Waitlist copy (1137), shared by /waitlist and the sign-up section the landing page shows while waitlist mode is on,
 * so the two never drift apart. "Free throughout the beta" is only said while the site really is in beta (Admin > Beta).
 */
export function waitlistPerks(beta: boolean) {
  return [
    "Early access, offered in the order people join.",
    beta ? "Free to use throughout the beta. No credit card required." : "Free plan to start. No credit card required.",
    "One email when your invitation is ready. No unnecessary emails.",
  ];
}

/** How the waitlist works, in three steps. */
export const WAITLIST_STEPS: readonly (readonly [string, string])[] = [
  ["Join", "Leave your email. It takes five seconds."],
  ["Get your invite", "We let people in by the order they joined."],
  ["Start posting", "Sign up with that email and bring a video."],
];
