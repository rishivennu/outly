import type { PipMood } from "@/components/brand/Pip";

/** What Pip can see on the sign in / sign up card (1075). Values are the settled ones (a beat after typing stops). */
export type WatchState = {
  mode: "login" | "signup";
  step: "password" | "code" | "reset" | "2fa";
  /** id of the focused control, or null. */
  focus: string | null;
  name: string;
  email: string;
  password: string;
  busy: boolean;
  error: string | null;
  success: string | null;
  /** A code was sent for this step. */
  sent: boolean;
  adult: boolean;
};

export type WatchLine = { mood: PipMood; say: string; shut?: boolean };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const looksLikeEmail = (s: string) => EMAIL.test(s.trim());

/** First word of the name, short enough that the bubble stays on one line. */
export function firstName(name: string): string {
  const w = name.trim().split(/\s+/)[0] ?? "";
  return w.length > 14 ? `${w.slice(0, 13)}…` : w;
}

const PASSWORD_FIELDS = new Set(["password", "new-password", "confirm-password"]);

/**
 * Pip watches the form like the mascot in the "sign up component" reel: greets, asks for your name, says it
 * back, checks the email, closes its eyes for the password. One short line at a time, no em dashes.
 */
export function watchLine(s: WatchState): WatchLine {
  const first = firstName(s.name);
  if (s.busy)
    return { mood: "think", say: s.step === "password" ? (s.mode === "signup" ? "Setting things up…" : "Opening Outlly…") : s.sent || s.step === "2fa" ? "Checking…" : "Sending it now…" };
  if (s.error) return { mood: "sad", say: /18 or older/.test(s.error) ? "Just tick the 18+ box." : "Oops. Let's fix that." };
  const f = s.focus;
  if (f && PASSWORD_FIELDS.has(f)) return { mood: "idle", say: "I'm not looking.", shut: true };
  if (f?.startsWith("otp")) return { mood: "idle", say: s.step === "2fa" ? "The code from your app." : "Check your inbox." };
  if (s.success) return { mood: "happy", say: "Fresh password. Nice." };
  if (s.step === "2fa") return { mood: "idle", say: "One more step." };
  if (s.step === "reset") {
    if (f === "email" || f === "phone") return looksLikeEmail(s.email) && f === "email" ? { mood: "idle", say: "That looks right." } : { mood: "idle", say: "Happens to everyone." };
    return { mood: "idle", say: s.sent ? "Check your inbox." : "Happens to everyone." };
  }
  if (s.step === "code") {
    if (s.sent) return { mood: "idle", say: "Check your inbox." };
    return f === "email" && looksLikeEmail(s.email) ? { mood: "idle", say: "That looks right." } : { mood: "idle", say: "I'll email you a code." };
  }
  if (f === "name") return { mood: "idle", say: first ? `Hi ${first}!` : "Hi! What's your name?" };
  if (f === "email") {
    if (looksLikeEmail(s.email)) return { mood: "idle", say: "That looks right." };
    if (s.mode === "signup") return { mood: "idle", say: first ? `Nice to meet you, ${first}!` : "And your email?" };
    return { mood: "idle", say: "Welcome back!" };
  }
  // Nothing typed into, or a button or checkbox has focus.
  if (s.email.trim() && !looksLikeEmail(s.email)) return { mood: "think", say: "Hmm, check that email?" };
  if (s.mode === "login") return { mood: "wave", say: "Welcome back!" };
  if (first && looksLikeEmail(s.email) && s.password.length >= 8) return s.adult ? { mood: "happy", say: `All set, ${first}!` } : { mood: "idle", say: "Almost there." };
  if (first) return { mood: "idle", say: `Hi ${first}!` };
  return { mood: "wave", say: "Hi! What's your name?" };
}
