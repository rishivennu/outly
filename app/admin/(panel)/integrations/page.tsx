import { requireAdmin } from "@/lib/admin/guard";
import { getConfig, redact } from "@/lib/settings";
import { env } from "@/lib/env";
import { PageHead } from "@/components/admin/ui";
import { IntegrationsForm } from "@/components/admin/IntegrationsForm";
import { WhatsAppCard } from "@/components/admin/WhatsAppCard";

export const metadata = { title: "Integrations" };

export default async function Integrations() {
  await requireAdmin("integrations");
  const [p, e, w] = await Promise.all([getConfig("payments"), getConfig("email"), getConfig("whatsapp")]);
  const base = env.APP_URL.replace(/\/$/, "");
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Integrations"
        body="Switch payment gateways and email providers here, no code or redeploy. Keys are encrypted in the database and never shown again after saving. Mock is on by default so you can test everything safely."
      />
      <IntegrationsForm payments={redact("payments", p)} email={redact("email", e)} webhooks={{ stripe: `${base}/api/billing/webhooks/stripe`, razorpay: `${base}/api/billing/webhooks/razorpay`, paypal: `${base}/api/billing/webhooks/paypal`, youpi: `${base}/api/billing/webhooks/youpi` }} />
      <div className="mt-5">
        <WhatsAppCard initial={redact("whatsapp", w)} />
      </div>
    </>
  );
}
