/**
 * Same idea for every platform's connect: name the setting that's wrong. Meta words its token errors
 * ("Error validating client secret", "Invalid platform app", "Matching code was not found or was already
 * used"); Google, X, TikTok and LinkedIn use the OAuth names (invalid_client, redirect_uri_mismatch, invalid_grant).
 */
export function connectReason(e: unknown) {
  if ((e as { code?: string })?.code === "NO_CHANNEL") return "no_channel";
  const t = `${(e as { technical?: string })?.technical ?? ""} ${(e as Error)?.message ?? ""}`;
  if (/redirect_uri|redirect uri/i.test(t)) return "redirect";
  if (/invalid_client|unauthorized_client|client secret|invalid platform app|invalid app id|client_id/i.test(t)) return "config";
  if (/matching code was not found|already (been )?used|code has expired|expired authorization code|invalid_grant|authorization code/i.test(t)) return "state";
  if (/prisma|database|ECONNREFUSED|P10\d\d|P20\d\d/i.test(t)) return "server";
  return "exchange";
}

const STEPS: Record<string, string> = {
  "token exchange": "swapping the sign-in code for a token",
  "long-lived exchange": "swapping for a 60-day token",
  profile: "reading the account profile",
};

/**
 * One line the owner can act on (1031e): which step failed and the platform's own words. Built only from
 * the error's `technical` text; anything token-like (long runs of letters and digits) is cut out, and the
 * line is capped, so it is safe to show and to paste into a support chat.
 */
export function connectDetail(e: unknown): string {
  const tech = String((e as { technical?: string })?.technical ?? "");
  const msg = String((e as Error)?.message ?? "");
  const head = tech.split("\n")[0] ?? "";
  const stepKey = Object.keys(STEPS).find((k) => head.includes(k));
  const status = /HTTP (\d{3})/.exec(head)?.[1];
  let said = "";
  const body = tech.slice(head.length).trim();
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const er = (j.error && typeof j.error === "object" ? j.error : j) as Record<string, unknown>;
    said = [er.error_message, er.message, er.error_description, typeof j.error === "string" ? j.error : undefined, er.error_user_msg].find((x) => typeof x === "string" && x) as string ?? "";
    const code = er.code ?? er.error_code;
    if (said && code !== undefined) said += ` (code ${String(code).slice(0, 12)})`;
  } catch {
    said = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  if (!said) said = msg;
  const line = [stepKey ? `Failed while ${STEPS[stepKey]}` : "", status ? `HTTP ${status}` : "", said].filter(Boolean).join(". ");
  return line.replace(/[A-Za-z0-9_\-]{32,}/g, "[hidden]").replace(/[\r\n]+/g, " ").slice(0, 240);
}
