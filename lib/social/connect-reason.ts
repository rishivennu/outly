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
