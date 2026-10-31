/**
 * Throwaway inboxes (1076): blocked when an account is created (email or WhatsApp sign-up) and on the
 * waitlist, so free plans, referral months and founding seats can't be farmed with burner addresses, and
 * invoices and sign-in codes reach a mailbox the person keeps. Existing accounts still sign in and reset.
 * Client-safe. Subdomains count too (x.mailinator.com). Keep the list to well-known services; a false
 * positive costs a real sign-up.
 */
const DOMAINS = new Set(
  `0-mail.com 10mail.org 10minutemail.com 10minutemail.net 20minutemail.com 33mail.com 4warding.com
  anonbox.net anonymbox.com binkmail.com bobmail.info burnermail.io byom.de chacuo.net
  discard.email discardmail.com discardmail.de dispostable.com dropmail.me
  emailondeck.com emailtemporanea.net emailfake.com emltmp.com fakeinbox.com fakemail.net fakemailgenerator.com
  getairmail.com getnada.com guerrillamail.biz guerrillamail.com guerrillamail.de guerrillamail.info guerrillamail.net guerrillamail.org guerrillamailblock.com grr.la
  harakirimail.com inboxbear.com inboxkitten.com incognitomail.org jetable.org
  mail-temp.com mail.tm mail7.io maildrop.cc mailcatch.com maildim.com mailinator.com mailinator.net mailinator2.com mailnesia.com mailpoof.com mailsac.com mailtemp.net mailtothis.com mintemail.com mohmal.com moakt.com mytemp.email mytrashmail.com
  nada.email nowmymail.com owlymail.com pokemail.net sharklasers.com spam4.me spambog.com spambox.us spamgourmet.com spamex.com
  temp-mail.io temp-mail.org tempail.com tempemail.net tempinbox.com tempmail.com tempmail.dev tempmail.net tempmail.plus tempmailo.com tempmailaddress.com tempr.email tempsky.com
  throwawaymail.com tmail.ws tmailor.com tmpmail.net tmpmail.org trash-mail.com trashmail.com trashmail.de trashmail.net trashmail.me
  wegwerfmail.de yopmail.com yopmail.fr yopmail.net 1secmail.com 1secmail.net 1secmail.org`
    .split(/\s+/)
    .filter(Boolean),
);

export const DISPOSABLE_MESSAGE = "That looks like a throwaway inbox. Use an email you'll keep, so your invoices and sign-in codes reach you.";

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const parts = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < parts.length - 1; i++) if (DOMAINS.has(parts.slice(i).join("."))) return true;
  return false;
}
