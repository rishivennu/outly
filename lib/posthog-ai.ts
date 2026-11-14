import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";

type AiTurn = {
  distinctId?: string;
  sessionId: string | null;
  traceId: string;
};

type AiGeneration = {
  provider: string;
  model: string;
  input: unknown;
  output?: string;
  latency: number;
  stream?: boolean;
  timeToFirstToken?: number;
  requestUrl: string;
  temperature?: number;
  httpStatus?: number;
  error?: string;
  spanName: string;
};

const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (!token && process.env.NODE_ENV !== "production")
  console.warn("NEXT_PUBLIC_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_KEY is configured");
if (!host && process.env.NODE_ENV !== "production")
  console.warn("NEXT_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_HOST is configured");

const posthog = token && host && process.env.NODE_ENV !== "test" ? new PostHog(token, { host, privacyMode: false, enableExceptionAutocapture: true, flushAt: 1, flushInterval: 0, requestTimeout: 2000, fetchRetryCount: 0 }) : null;
const aiTurn = new AsyncLocalStorage<AiTurn>();

export function hasAiTurn() {
  return !!aiTurn.getStore();
}

export function withAiTurn<T>(context: { distinctId?: string; sessionId?: string | null }, run: () => Promise<T>) {
  return aiTurn.run({ distinctId: context.distinctId, sessionId: context.sessionId ?? null, traceId: randomUUID() }, run);
}

export async function captureAiGeneration(generation: AiGeneration) {
  const turn = aiTurn.getStore() ?? { sessionId: null, traceId: randomUUID() };
  if (!posthog) return;
  try {
    posthog.capture({
      distinctId: turn.distinctId ?? turn.traceId,
      event: "$ai_generation",
      properties: {
        $ai_trace_id: turn.traceId,
        $ai_session_id: turn.sessionId,
        $ai_span_name: generation.spanName,
        $ai_model: generation.model,
        $ai_provider: generation.provider,
        $ai_input: generation.input,
        ...(generation.output === undefined ? {} : { $ai_output_choices: [{ role: "assistant", content: generation.output }] }),
        $ai_latency: generation.latency,
        ...(generation.stream ? { $ai_stream: true } : {}),
        ...(generation.timeToFirstToken === undefined ? {} : { $ai_time_to_first_token: generation.timeToFirstToken }),
        $ai_request_url: generation.requestUrl,
        ...(generation.temperature === undefined ? {} : { $ai_temperature: generation.temperature }),
        ...(generation.httpStatus === undefined ? {} : { $ai_http_status: generation.httpStatus }),
        ...(generation.error === undefined ? {} : { $ai_is_error: true, $ai_error: generation.error }),
      },
    });
    await posthog.flush().catch(() => {});
  } catch {
    // AI observability must never change the result of a provider request.
  }
}
