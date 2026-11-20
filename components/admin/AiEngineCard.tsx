"use client";
import { useState } from "react";
import { AudioLines, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import type { SubtitleRules } from "@/lib/captions/subtitle-engine";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill } from "./ui";

const ease = "ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

/**
 * Subtitle engine switch (Phase 3) on the existing GET/PUT /api/admin/engines. The cloud engine is the default and
 * stays selected unless an admin explicitly picks the self-hosted worker. The whole rules object is sent back,
 * because the server fills anything missing from the code defaults. R1177: provider "gemini" now means "cloud":
 * Whisper on Groq when GROQ_API_KEY is set, Gemini otherwise, so the pill names the engine that really answers.
 */
const activeName = (provider: SubtitleRules["provider"], groqEnv: boolean) => (provider === "funasr" ? "Self-hosted worker" : groqEnv ? "Whisper (Groq)" : "Gemini");

export function AiEngineCard({ initial, funasrEnv, groqEnv }: { initial: SubtitleRules; funasrEnv: boolean; groqEnv: boolean }) {
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [provider, setProvider] = useState<SubtitleRules["provider"]>(initial.provider);
  const [workerUrl, setWorkerUrl] = useState(initial.workerUrl);
  const [model, setModel] = useState(initial.model);
  const [open, setOpen] = useState(initial.provider === "funasr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = workerUrl.trim();
  const urlOk = url === "" || /^https?:\/\/\S+$/i.test(url);
  const workerReady = !!url || funasrEnv;
  const dirty = provider !== saved.provider || url !== saved.workerUrl || model.trim() !== saved.model;
  const blocked = !urlOk || (provider === "funasr" && !workerReady);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi<{ subtitles: SubtitleRules }>("/api/admin/engines", { method: "PUT", json: { key: "subtitles", rules: { ...saved, provider, workerUrl: url, model: model.trim() || saved.model } } });
      setSaved(r.subtitles);
      setProvider(r.subtitles.provider);
      setWorkerUrl(r.subtitles.workerUrl);
      setModel(r.subtitles.model);
      toast(r.subtitles.provider === "gemini" ? `Transcription runs on ${activeName("gemini", groqEnv)}.` : "Transcription runs on your self-hosted worker.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const option = (value: SubtitleRules["provider"], title: string, body: string, disabled = false) => (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl px-3 py-3 hairline transition-colors duration-200", ease, provider === value ? "bg-lime/10 ring-1 ring-[hsl(var(--lime)/0.55)]" : "bg-secondary/30", disabled && "cursor-not-allowed opacity-60")}>
      <input type="radio" name="subtitle-engine" value={value} className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--lime))]" checked={provider === value} disabled={disabled} onChange={() => setProvider(value)} />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-muted-foreground">{body}</span>
      </span>
    </label>
  );

  return (
    <Card>
      <CardTitle hint="Used for AI captions on videos and for translating them." action={<Pill tone={saved.provider === "gemini" ? "lime" : "info"}>{activeName(saved.provider, groqEnv)}</Pill>}>
        <span className="inline-flex items-center gap-2"><AudioLines className="h-4 w-4" aria-hidden /> Transcription engine</span>
      </CardTitle>
      <div role="radiogroup" aria-label="Transcription engine" className="grid gap-2">
        {option("gemini", "Cloud (default)", "Whisper on Groq when GROQ_API_KEY is set (fastest, word timings built in), Gemini otherwise or as the fallback. Detects the spoken language.")}
        <div className="rounded-2xl hairline">
          <button type="button" aria-expanded={open} aria-controls="engine-worker" onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl px-3 text-left text-[13.5px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:text-foreground">
            Self-hosted worker (FunASR / Whisper), optional
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-200", ease, open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <div id="engine-worker" className="grid gap-3 px-3 pb-3">
              {option("funasr", "Use my worker", workerReady ? "Word timings come from your own speech model." : "Add a worker URL below first (or set FUNASR_URL on the server).", !workerReady && provider !== "funasr")}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <Label htmlFor="engine-url">Worker URL</Label>
                  <Input id="engine-url" value={workerUrl} onChange={(e) => setWorkerUrl(e.target.value)} placeholder={funasrEnv ? "Empty uses FUNASR_URL" : "https://asr.example.org"} spellCheck={false} autoComplete="off" inputMode="url" aria-invalid={!urlOk} aria-describedby="engine-url-hint" className="font-mono text-[14px]" />
                  <p id="engine-url-hint" className={cn("mt-1 text-[12px]", urlOk ? "text-muted-foreground" : "text-destructive")}>{urlOk ? (funasrEnv ? "FUNASR_URL is set on the server. Leave empty to use it." : "A public https address.") : "Start with http:// or https://."}</p>
                </div>
                <div className="min-w-0">
                  <Label htmlFor="engine-model">Model label</Label>
                  <Input id="engine-model" value={model} maxLength={120} onChange={(e) => setModel(e.target.value)} spellCheck={false} autoComplete="off" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {provider === "funasr" && !workerReady && <p role="alert" className="mt-3 text-[13px] text-destructive">The worker needs a URL before it can be used.</p>}
      {error && <p role="alert" className="mt-3 text-[13px] text-destructive">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="lime" disabled={!dirty || blocked || busy} onClick={() => void save()}>
          {busy ? "Saving" : "Save engine"}
        </Button>
        {provider !== "gemini" && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setProvider("gemini")}>
            Back to cloud
          </Button>
        )}
      </div>
    </Card>
  );
}
