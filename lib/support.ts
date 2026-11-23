/**
 * R1306: the support queue every public page points at (/terms, /security, the contact form, invoices) and the
 * Reply-To every outgoing email falls back to, so a reply to a sign-in code or a receipt lands with the team and
 * not in the sending subdomain's mailbox.
 */
export const SUPPORT_EMAIL = "support@outlly.com";
