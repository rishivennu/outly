/**
 * This browser keeps offline copies of the Billing page and invoice PDFs (public/sw.js, cache
 * "outly-offline-v2") and the last invoice list (BillingView, localStorage "outly-invoices-v1").
 * Drop them on sign-out and account deletion, so the next person on a shared device, or anyone after
 * the account is gone, can't open them offline. Never throws and never waits longer than a second.
 */
const SW_CACHE_PREFIX = "outly-offline-";
const INVOICE_LIST_KEY = "outly-invoices-v1";
const BILLING_PATH = /^\/(billing\/?|api\/billing\/invoices\/[\w-]+)$/;

export async function forgetBillingCopies() {
  try {
    localStorage.removeItem(INVOICE_LIST_KEY);
  } catch {
    /* storage blocked */
  }
  if (typeof caches === "undefined") return;
  const work = (async () => {
    for (const name of await caches.keys()) {
      if (!name.startsWith(SW_CACHE_PREFIX)) continue;
      const c = await caches.open(name);
      for (const req of await c.keys()) if (BILLING_PATH.test(new URL(req.url).pathname)) await c.delete(req);
    }
  })().catch(() => {});
  await Promise.race([work, new Promise((r) => setTimeout(r, 1000))]);
}
