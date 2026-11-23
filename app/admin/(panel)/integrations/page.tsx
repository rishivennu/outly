import { requireAdmin } from "@/lib/admin/guard";
import { getConfig, redact } from "@/lib/settings";
import { env } from "@/lib/env";
import { PageHead } from "@/components/admin/ui";
import { IntegrationsForm } from "@/components/admin/IntegrationsForm";
import { WhatsAppCard } from "@/components/admin/WhatsAppCard";
import { GoogleCalendarCard } from "@/components/admin/GoogleCalendarCard";
import { AiEngineCard } from "@/components/admin/AiEngineCard";
import { subtitleRules } from "@/lib/ai/engine-store";
import { calendarStatus } from "@/lib/google/calendar";

export const metadata = { title: "Integrations" };

export default async function Integrations() {
  await requireAdmin("integrations");
  const [p, e, w, subtitles] = await Promise.all([getConfig("payments"), getConfig("email"), getConfig("whatsapp"), subtitleRules()]);
  const calendar = await calendarStatus();
  const base = env.APP_URL.replace(/\/$/, "");
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Integrations"
        body="Switch payment gateways and email providers. Keys are encrypted and never shown again."
      />
      <IntegrationsForm payments={redact("payments", p)} email={redact("email", e)} webhooks={{ stripe: `${base}/api/billing/webhooks/stripe`, razorpay: `${base}/api/billing/webhooks/razorpay`, paypal: `${base}/api/billing/webhooks/paypal`, youpi: `${base}/api/billing/webhooks/youpi` }} />
      <div className="mt-5">
        <WhatsAppCard initial={redact("whatsapp", w)} />
      </div>
      <div className="mt-5">
        <GoogleCalendarCard initial={calendar} />
      </div>
      <div className="mt-5">
        <AiEngineCard initial={subtitles} funasrEnv={!!env.FUNASR_URL} groqEnv={!!env.GROQ_API_KEY} />
      </div>
    </>
  );
}
