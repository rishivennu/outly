import { json, route } from "@/lib/http";
import { sendChallengeWhatsApp } from "@/lib/otp/two-factor";

/** Second step: send a code to the account's proven WhatsApp number instead of using the app. */
export const POST = route(async () => json(await sendChallengeWhatsApp()), { auth: false, limit: [6, 10 * 60_000] });
