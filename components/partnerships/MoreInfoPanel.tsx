"use client";
import { useId, useState } from "react";
import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Counter, Input, Label, Textarea } from "@/components/ui/field";
import { Files } from "@/components/partners/form/Files";
import type { UploadedFile } from "@/components/partners/form/draft";
import type { MineInfoRequest, MineSocial } from "@/lib/partners/mine-types";
import { PARTNER_PLATFORMS } from "@/lib/partners/types";
import { fmtDay } from "@/lib/partners/offer-core";
import { API, platformLabel } from "./model";
import { useAction } from "./useAction";

const REPLY_MAX = 2000;
type Row = { platform: string; handle: string; url: string; followers: string };
const SELECT = "h-12 w-full rounded-2xl bg-secondary/60 px-4 text-base text-foreground field-edge focus:bg-secondary focus-visible:outline-2";
const digits = (s: string) => s.replace(/[^\d]/g, "");

/** The team asked for more. The creator replies, and can add or correct platforms, average views and files. */
export function MoreInfoPanel({ appRef, request, socials, avgViews }: { appRef: string; request: NonNullable<MineInfoRequest>; socials: MineSocial[]; avgViews: number }) {
  const { busy, run } = useAction();
  const id = useId();
  const [reply, setReply] = useState("");
  const [editPlatforms, setEditPlatforms] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => (socials.length ? socials : [{ platform: "instagram", handle: "", url: "", followers: 0, primary: true }]).map((s) => ({ platform: s.platform, handle: s.handle, url: s.url, followers: s.followers ? String(s.followers) : "" })));
  const [views, setViews] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(0);
  const [tried, setTried] = useState(false);
  const empty = reply.trim().length < 3;

  const setRow = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (empty || uploading > 0 || reply.length > REPLY_MAX) return;
    const body: Record<string, unknown> = { message: reply.trim() };
    if (editPlatforms) body.socials = rows.filter((r) => r.url.trim() || r.handle.trim()).map((r, i) => ({ platform: r.platform, handle: r.handle.trim(), url: r.url.trim(), followers: Number(digits(r.followers)) || 0, primary: i === 0 }));
    if (digits(views)) body.stats = { avgViews: Number(digits(views)) };
    if (files.length) body.files = files.map((f) => ({ token: f.token, name: f.name }));
    const ok = await run(API.info(appRef), body, "Thanks, your update is with our team.");
    if (ok) {
      setReply("");
      setFiles([]);
      setTried(false);
    }
  }

  return (
    <section id="more-info" aria-labelledby={`${id}-h`} className="scroll-mt-24 rounded-[24px] border border-warning/40 bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warning/15 text-warning-ink">
          <MessageSquareText className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="text-[17px] font-semibold leading-snug">Our team needs additional information</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Asked on {fmtDay(request.requestedAt)}. Everything you sent before stays as it is unless you change it here.</p>
        </div>
      </div>
      {request.message && (
        <blockquote className="mt-4 whitespace-pre-line rounded-2xl bg-secondary/60 px-4 py-3 text-[15px] leading-relaxed [overflow-wrap:anywhere]">
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">What we need</span>
          {request.message}
        </blockquote>
      )}

      <form onSubmit={submit} noValidate className="mt-5 grid gap-5">
        <div>
          <Label htmlFor={`${id}-reply`}>
            <span>Your reply</span>
            <Counter value={reply.length} max={REPLY_MAX} />
          </Label>
          <Textarea id={`${id}-reply`} rows={4} maxLength={REPLY_MAX} value={reply} onChange={(e) => setReply(e.target.value)} aria-invalid={tried && empty} aria-describedby={tried && empty ? `${id}-reply-err` : undefined} required />
          {tried && empty && (
            <p id={`${id}-reply-err`} className="mt-2 text-[13px] text-[hsl(0_72%_38%)] dark:text-destructive">Write a short reply so the team knows what changed.</p>
          )}
        </div>

        <div className="grid gap-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px] font-medium">
            <input type="checkbox" checked={editPlatforms} onChange={(e) => setEditPlatforms(e.target.checked)} className="h-5 w-5 shrink-0 accent-lime" />
            Add or update my platforms
          </label>
          {editPlatforms && (
            <fieldset className="grid gap-3">
              <legend className="sr-only">Your platforms</legend>
              {rows.map((r, i) => (
                <div key={i} className="grid gap-3 rounded-2xl bg-secondary/30 p-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`${id}-p${i}`}>Platform</Label>
                    <select id={`${id}-p${i}`} value={r.platform} onChange={(e) => setRow(i, { platform: e.target.value })} className={SELECT}>
                      {PARTNER_PLATFORMS.map((p) => (
                        <option key={p} value={p}>{platformLabel(p)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor={`${id}-h${i}`}>Username</Label>
                    <Input id={`${id}-h${i}`} autoComplete="off" autoCapitalize="none" spellCheck={false} value={r.handle} onChange={(e) => setRow(i, { handle: e.target.value })} placeholder="@yourname" />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor={`${id}-u${i}`}>Profile or channel link</Label>
                    <Input id={`${id}-u${i}`} type="url" inputMode="url" autoComplete="url" value={r.url} onChange={(e) => setRow(i, { url: e.target.value })} placeholder="https://" />
                  </div>
                  <div>
                    <Label htmlFor={`${id}-f${i}`}>Followers</Label>
                    <Input id={`${id}-f${i}`} inputMode="numeric" value={r.followers} onChange={(e) => setRow(i, { followers: digits(e.target.value) })} placeholder="12000" />
                  </div>
                  <div className="flex items-end justify-end">
                    <Button type="button" variant="ghost" size="md" disabled={rows.length <= 1} onClick={() => setRows((all) => all.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove {platformLabel(r.platform)}
                    </Button>
                  </div>
                </div>
              ))}
              {rows.length < 6 && (
                <Button type="button" variant="outline" size="md" className="justify-self-start" onClick={() => setRows((all) => [...all, { platform: "instagram", handle: "", url: "", followers: "" }])}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add another platform
                </Button>
              )}
            </fieldset>
          )}
        </div>

        <div className="max-w-xs">
          <Label htmlFor={`${id}-views`}>Average views per post (optional)</Label>
          <Input id={`${id}-views`} inputMode="numeric" value={views} onChange={(e) => setViews(digits(e.target.value))} placeholder={avgViews ? String(avgViews) : "5000"} aria-describedby={`${id}-views-help`} />
          <p id={`${id}-views-help`} className="mt-1.5 text-[12px] text-muted-foreground">Self-reported. Leave blank to keep what you sent.</p>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium text-muted-foreground">Screenshots or media kit (optional)</p>
          <Files files={files} onChange={setFiles} onBusy={setUploading} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" variant="lime" size="md" disabled={busy || uploading > 0} aria-busy={busy} className="w-full sm:w-auto">
            {busy ? "Sending…" : "Update application"}
          </Button>
          {uploading > 0 && <p className="text-[13px] text-muted-foreground" aria-live="polite">Waiting for your files to finish uploading.</p>}
        </div>
      </form>
    </section>
  );
}
