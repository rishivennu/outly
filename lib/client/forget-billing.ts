import { clearDeviceDrafts } from "./device-drafts";
import { ONBOARDING_CACHE_PREFIX } from "@/components/onboarding/onboarding-client";

/**
 * This browser keeps offline copies of the Billing page and invoice PDFs (public/sw.js, cache
 * "outly-offline-v2") and the last invoice list (BillingView, localStorage "outly-invoices-v1").
 * Drop them on sign-out and account deletion, so the next person on a shared device, or anyone after
 * the account is gone, can't open them offline. Never throws and never waits longer than a second.
 * Phase 2: the drafts kept on this device (lib/client/device-drafts, every account's) go too, and so does
 * the guided setup's cached progress (components/onboarding/onboarding-client).
 */
const SW_CACHE_PREFIX = "outly-offline-";
// The service worker's copies of studio pages (public/sw.js PAGES): the signed-in person's own screens, all dropped.
const SW_PAGES_CACHE = "outly-pages-v1";
const INVOICE_LIST_KEY = "outly-invoices-v1";
const BILLING_PATH = /^\/(billing\/?|api\/billing\/invoices\/[\w-]+)$/;

export async function forgetLocalCopies() {
  const drafts = clearDeviceDrafts().catch(() => {});
  try {
    localStorage.removeItem(INVOICE_LIST_KEY);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(ONBOARDING_CACHE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* storage blocked */
  }
  const work = (async () => {
    if (typeof caches === "undefined") return;
    await caches.delete(SW_PAGES_CACHE);
    for (const name of await caches.keys()) {
      if (!name.startsWith(SW_CACHE_PREFIX)) continue;
      const c = await caches.open(name);
      for (const req of await c.keys()) if (BILLING_PATH.test(new URL(req.url).pathname)) await c.delete(req);
    }
  })().catch(() => {});
  await Promise.race([Promise.all([work, drafts]), new Promise((r) => setTimeout(r, 1000))]);
}
/** The older name: every sign-out and account-deletion path calls it, so it clears drafts as well. */
export const forgetBillingCopies = forgetLocalCopies;
