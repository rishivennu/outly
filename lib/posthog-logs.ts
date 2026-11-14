import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (!token && process.env.NODE_ENV !== "production")
  console.warn("NEXT_PUBLIC_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_KEY is configured");
if (!host && process.env.NODE_ENV !== "production")
  console.warn("NEXT_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_HOST is configured");

const loggerProvider = token && host
  ? new LoggerProvider({
      resource: resourceFromAttributes({ "service.name": "creator-studio" }),
      processors: [
        new BatchLogRecordProcessor(
          new OTLPLogExporter({
            url: `${host}/i/v1/logs`,
            timeoutMillis: 2000,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }),
        ),
      ],
    })
  : null;

const posthogLogger = loggerProvider?.getLogger("creator-studio.posthog");

export function initializePostHogLogCapture(runtime: "nextjs" | "worker") {
  posthogLogger?.emit({
    body: "PostHog log capture initialized",
    severityNumber: SeverityNumber.INFO,
    attributes: { event: "posthog_log_capture_initialized", runtime },
  });
}

export function emitPostHogLog(body: string, attributes: Record<string, string | number | boolean>) {
  posthogLogger?.emit({ body, severityNumber: SeverityNumber.INFO, attributes });
}

export async function flushPostHogLogs() {
  await loggerProvider?.forceFlush().catch(() => {});
}
