/**
 * Phone numbers for WhatsApp codes, kept in E.164 ("+919876543210"). Pure, so the sign-in form, the
 * server and the tests all agree on what a number is.
 *
 * India is the default: a bare 10-digit mobile ("98765 43210") or one with a trunk 0 ("098765 43210")
 * becomes +91. Anything else needs its country code, with a + or 00 in front.
 */
export function normalizePhone(input: string, defaultCc = "91"): string | null {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 32) return null;
  if (/[^\d\s+().-]/.test(raw)) return null; // letters, slashes and so on: not a phone number
  const plus = raw.startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (!plus && d.startsWith("00")) d = d.slice(2);
  else if (!plus) {
    if (defaultCc === "91" && /^0?[6-9]\d{9}$/.test(d)) d = `91${d.replace(/^0/, "")}`;
    else if (!(defaultCc === "91" && /^91[6-9]\d{9}$/.test(d))) return null;
  }
  if (!/^[1-9]\d{7,14}$/.test(d)) return null;
  // An Indian number has exactly 10 digits after +91 and starts 6-9 (mobiles; WhatsApp needs one).
  if (d.startsWith("91") && !/^91[6-9]\d{9}$/.test(d)) return null;
  return `+${d}`;
}

/** "+919876543210" -> "+91 ••••• •3210". Enough to recognise your own number, not enough to dial it. */
export function maskPhone(e164: string | null | undefined): string | null {
  if (!e164 || !/^\+\d{8,15}$/.test(e164)) return null;
  const d = e164.slice(1);
  const cc = d.startsWith("91") ? "91" : d.startsWith("1") ? "1" : d.slice(0, 2);
  const rest = d.slice(cc.length);
  return `+${cc} ${"•".repeat(Math.max(2, rest.length - 4))}${rest.slice(-4)}`;
}

/**
 * Body for Meta's Cloud API: an Authentication template whose body is "{{1}} is your verification code"
 * and whose copy-code (or one-tap) button carries the same code. Meta requires the code in both places.
 */
export function whatsappCodePayload(to: string, code: string, template: string, lang: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: template,
      language: { code: lang || "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ],
    },
  };
}

/** Meta's error text can quote what we sent. Never let a live code reach a log or the admin screen. */
export function redactCode(text: string, code: string): string {
  return code ? String(text).split(code).join("••••••") : String(text);
}
