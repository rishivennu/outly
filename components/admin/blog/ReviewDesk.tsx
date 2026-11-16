"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ExternalLink, Loader2, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { countWords, type BlogJobView, type BlogPostPatch, type BlogPostView } from "@/lib/blog/types";
import { renderMarkdown } from "@/lib/blog/markdown";
import { Card, CardTitle, Pill, fmtDate } from "../ui";
import { ArticleBody } from "./ArticleBody";

type Tab = "write" | "preview" | "seo" | "sources";
const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" | "lime" | "info" }> = {
  pending: { label: "Pending approval", tone: "warn" },
  approved: { label: "Approved, not live", tone: "info" },
  published: { label: "Published", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
};

/**
 * R1175 review desk. The admin reads, edits and decides. Nothing here is automatic: Save writes the edits,
 * Approve & Publish is the only way an article goes live, and the server re-checks quality on both.
 */
export function ReviewDesk({ initial, categories, allowedLinks, siteUrl }: { initial: BlogPostView; categories: string[]; allowedLinks: { href: string; label: string }[]; siteUrl: string }) {
  const [post, setPost] = useState(initial);
  const [d, setD] = useState<BlogPostPatch>(toPatch(initial));
  const [tab, setTab] = useState<Tab>("write");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "reject" | "rewrite" | null>(null);
  const [reason, setReason] = useState("");
  const [regen, setRegen] = useState<{ heading: string; note: string }>({ heading: "", note: "" });
  const toast = useToast();
  const router = useRouter();
  const dirty = JSON.stringify(d) !== JSON.stringify(toPatch(post));
  const headings = useMemo(() => renderMarkdown(d.bodyMd ?? "").headings.filter((h) => h.level === 2), [d.bodyMd]);
  const words = countWords(d.bodyMd ?? "");
  const live = post.status === "published";
  const set = <K extends keyof BlogPostPatch>(k: K, v: BlogPostPatch[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save(): Promise<BlogPostView | null> {
    if (!dirty) return post;
    setBusy("save");
    setErr(null);
    try {
      const r = await adminApi<{ post: BlogPostView }>(`/api/admin/blog/posts/${post.id}`, { method: "PATCH", json: d });
      setPost(r.post);
      setD(toPatch(r.post));
      toast("Changes saved");
      return r.post;
    } catch (e: any) {
      setErr(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setErr(null);
    try {
      if (dirty && !(await save())) return;
      const r = await adminApi<{ post: BlogPostView }>(`/api/admin/blog/posts/${post.id}`, { method: "POST", json: { action, ...extra } });
      setPost(r.post);
      setD(toPatch(r.post));
      toast(action === "publish" ? "Published. It is live now." : action === "unpublish" ? "Taken offline" : action === "reject" ? "Article rejected" : action === "restore" ? "Back in the review queue" : "Section rewritten");
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }
  async function rewrite() {
    setBusy("rewrite");
    setErr(null);
    try {
      const r = await adminApi<{ job: BlogJobView; existed: boolean }>("/api/admin/blog/jobs", { method: "POST", json: { rewriteOf: post.id, hint: reason.trim() } });
      toast(r.existed ? "A run is already going; follow it on Generate blog" : "Rewrite started");
      router.push("/admin/blog/generate");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const q = post.quality;
  const blocking = q?.checks.filter((c) => c.critical && !c.ok) ?? [];
  const st = STATUS[post.status] ?? { label: post.status, tone: "muted" as const };

  return (
    <div className="grid gap-5">
      <Card as="div" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-muted-foreground">
          <Pill tone={st.tone}>{st.label}</Pill>
          <span>{post.wordCount} words</span>
          <span aria-hidden>·</span>
          <span>{post.readingMin} min read</span>
          <span aria-hidden>·</span>
          <span>Created {fmtDate(post.createdAt, true)}</span>
          {post.publishedAt && (
            <>
              <span aria-hidden>·</span>
              <a href={`${siteUrl}/blog/${post.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
                View live <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={save} disabled={!dirty || !!busy} className="min-h-11">
            {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save changes
          </Button>
          {post.status === "rejected" ? (
            <Button type="button" variant="subtle" onClick={() => act("restore")} disabled={!!busy} className="min-h-11">
              Restore to pending
            </Button>
          ) : live ? (
            <Button type="button" variant="outline" onClick={() => act("unpublish")} disabled={!!busy} className="min-h-11">
              Unpublish
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setConfirm("rewrite")} disabled={!!busy} className="min-h-11">
                <RefreshCw className="h-4 w-4" aria-hidden /> Request rewrite
              </Button>
              <Button type="button" variant="danger" onClick={() => setConfirm("reject")} disabled={!!busy} className="min-h-11">
                Reject
              </Button>
              <Button type="button" variant="lime" onClick={() => setConfirm("publish")} disabled={!!busy || blocking.length > 0} className="min-h-11" title={blocking.length ? "Fix the blocking quality checks first" : undefined}>
                <Check className="h-4 w-4" aria-hidden /> Approve &amp; Publish
              </Button>
            </>
          )}
        </div>
        {err && (
          <p role="alert" className="basis-full text-[13.5px] text-destructive">
            {err}
          </p>
        )}
        {!live && blocking.length > 0 && (
          <p className="basis-full rounded-2xl bg-warning/10 p-3 text-[13.5px]">
            <AlertTriangle className="mr-1.5 inline h-4 w-4" aria-hidden /> Publishing is blocked until these pass: {blocking.map((c) => c.label).join("; ")}. Edit the article or regenerate a section, then save.
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card as="div" className="min-w-0">
          <div role="tablist" aria-label="Article views" className="flex flex-wrap gap-1 rounded-full bg-secondary p-1">
            {(["write", "preview", "seo", "sources"] as Tab[]).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("min-h-10 rounded-full px-4 text-[13.5px] font-medium capitalize", tab === t ? "bg-card shadow-sm" : "text-muted-foreground")}>
                {t === "seo" ? "SEO" : t === "sources" ? "Sources & quality" : t}
              </button>
            ))}
          </div>

          {tab === "write" && (
            <div className="mt-4 grid gap-4">
              <Field label="Title" id="t">
                <Input id="t" value={d.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={200} className="text-[1.05rem] font-semibold" />
              </Field>
              <Field label={`Body (Markdown, ${words} words)`} id="b" hint="## starts a section. Links may point only at outlly.com pages or the recorded sources.">
                <Textarea id="b" value={d.bodyMd ?? ""} onChange={(e) => set("bodyMd", e.target.value)} rows={28} className="font-mono text-[13px] leading-relaxed" spellCheck />
              </Field>
              {!live && (
                <div className="rounded-2xl bg-secondary/60 p-4">
                  <p className="text-[13.5px] font-semibold">Regenerate one section</p>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">Rewrites only that section, keeping the rest. Unsaved edits are saved first.</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                    <div className="grid gap-1.5">
                      <Label htmlFor="rg-h">Section</Label>
                      <select id="rg-h" value={regen.heading} onChange={(e) => setRegen((r) => ({ ...r, heading: e.target.value }))} className="field min-h-11 rounded-xl border border-border bg-card px-3 text-[14px]">
                        <option value="">Choose a section</option>
                        {headings.map((h) => (
                          <option key={h.id} value={h.text}>
                            {h.text}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="rg-n">What should change</Label>
                      <Input id="rg-n" value={regen.note} onChange={(e) => setRegen((r) => ({ ...r, note: e.target.value }))} placeholder="e.g. more concrete, add what to measure" maxLength={600} />
                    </div>
                    <Button type="button" variant="subtle" disabled={!regen.heading || !!busy} onClick={() => act("regenerate", { heading: regen.heading, note: regen.note })} className="min-h-11">
                      {busy === "regenerate" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Regenerate
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "preview" && (
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-muted-foreground">How readers will see it at /blog/{d.slug}</p>
                <div role="group" aria-label="Preview width" className="flex gap-1 rounded-full bg-secondary p-1">
                  <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={cn("grid h-9 w-9 place-items-center rounded-full", device === "desktop" && "bg-card shadow-sm")} aria-label="Desktop preview">
                    <Monitor className="h-4 w-4" aria-hidden />
                  </button>
                  <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")} className={cn("grid h-9 w-9 place-items-center rounded-full", device === "mobile" && "bg-card shadow-sm")} aria-label="Mobile preview">
                    <Smartphone className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              <div className={cn("mx-auto mt-4 rounded-[20px] border border-border bg-background p-5 sm:p-8", device === "mobile" ? "max-w-[390px]" : "max-w-[720px]")}>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{d.category}</p>
                <h1 className="mt-2 font-display text-[1.6rem] font-bold leading-tight sm:text-[2rem]">{d.title}</h1>
                <p className="mt-2 text-[14px] text-muted-foreground">
                  {post.author} · {post.readingMin} min read
                </p>
                <ArticleBody md={d.bodyMd ?? ""} className="mt-6" />
              </div>
            </div>
          )}

          {tab === "seo" && (
            <div className="mt-4 grid gap-4">
              <Field label="URL slug" id="slug" hint={`${siteUrl}/blog/${d.slug ?? ""}${live ? " (unpublish before changing a live address)" : ""}`}>
                <Input id="slug" value={d.slug ?? ""} onChange={(e) => set("slug", e.target.value)} maxLength={100} disabled={live} />
              </Field>
              <Field label="SEO title" id="st" counter={[d.seoTitle?.length ?? 0, 60]}>
                <Input id="st" value={d.seoTitle ?? ""} onChange={(e) => set("seoTitle", e.target.value)} maxLength={120} />
              </Field>
              <Field label="Meta description" id="md" counter={[d.metaDescription?.length ?? 0, 155]}>
                <Textarea id="md" value={d.metaDescription ?? ""} onChange={(e) => set("metaDescription", e.target.value)} rows={3} maxLength={240} />
              </Field>
              <Field label="Excerpt (listing card)" id="ex">
                <Textarea id="ex" value={d.excerpt ?? ""} onChange={(e) => set("excerpt", e.target.value)} rows={2} maxLength={500} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" id="cat">
                  <select id="cat" value={d.category ?? ""} onChange={(e) => set("category", e.target.value)} className="field min-h-11 rounded-xl border border-border bg-card px-3 text-[14px]">
                    {!categories.includes(d.category ?? "") && <option value={d.category ?? ""}>{d.category || "Pick one"}</option>}
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Primary keyword" id="pk">
                  <Input id="pk" value={d.primaryKeyword ?? ""} onChange={(e) => set("primaryKeyword", e.target.value)} maxLength={80} />
                </Field>
              </div>
              <Field label="Secondary keywords (comma separated)" id="sk">
                <Input id="sk" value={(d.secondaryKeywords ?? []).join(", ")} onChange={(e) => set("secondaryKeywords", splitList(e.target.value))} />
              </Field>
              <Field label="Tags (comma separated)" id="tg">
                <Input id="tg" value={(d.tags ?? []).join(", ")} onChange={(e) => set("tags", splitList(e.target.value))} />
              </Field>
              <div className="grid gap-2">
                <p className="text-[13.5px] font-medium">Internal links</p>
                <p className="text-[12.5px] text-muted-foreground">Only existing Outlly pages and published articles can be chosen, so no link is ever invented.</p>
                <ul className="grid gap-1.5">
                  {allowedLinks.map((l) => {
                    const on = (d.internalLinks ?? []).some((x) => x.href === l.href);
                    return (
                      <li key={l.href}>
                        <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-2 text-[13.5px] hover:bg-secondary/60">
                          <input type="checkbox" checked={on} onChange={() => set("internalLinks", on ? (d.internalLinks ?? []).filter((x) => x.href !== l.href) : [...(d.internalLinks ?? []), l])} className="h-4 w-4" />
                          <span className="font-medium">{l.label}</span>
                          <span className="truncate text-muted-foreground">{l.href}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="grid gap-1 text-[13px] text-muted-foreground">
                <p>Search intent: {post.searchIntent || "unknown"}</p>
                {post.relatedQuestions.length > 0 && <p>Related questions: {post.relatedQuestions.join(" · ")}</p>}
                <p>Canonical: {siteUrl}/blog/{d.slug}</p>
                <p>Structured data: BlogPosting with author {post.author}, publisher Outlly, real publish and update dates. No ratings or review schema.</p>
              </div>
            </div>
          )}

          {tab === "sources" && (
            <div className="mt-4 grid gap-5">
              <div>
                <p className="text-[13.5px] font-semibold">Research sources</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">"Verified" means the page came back in live search results during research. Unverified sources were named by the AI and should be checked by hand before the article leans on them.</p>
                {post.sources.length ? (
                  <ul className="mt-3 grid gap-2">
                    {post.sources.map((s) => (
                      <li key={s.id} className="rounded-xl border border-border p-3 text-[13.5px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill tone={s.verified ? "ok" : "warn"}>{s.verified ? "Verified" : "Unverified"}</Pill>
                          <Pill tone="muted">{s.kind}</Pill>
                          <a href={s.url} target="_blank" rel="noreferrer nofollow" className="min-w-0 truncate font-medium underline underline-offset-4">
                            {s.title || s.url}
                          </a>
                        </div>
                        <p className="mt-1 break-all text-[12.5px] text-muted-foreground">
                          {s.url} · accessed {fmtDate(s.accessedAt)}
                        </p>
                        {s.supports && <p className="mt-1 text-[12.5px]">Supports: {s.supports}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[13.5px] text-muted-foreground">No sources were recorded for this article.</p>
                )}
              </div>
              <div>
                <p className="text-[13.5px] font-semibold">Pain point</p>
                <p className="mt-1 text-[13.5px]">{post.painPoint || "Not recorded."}</p>
              </div>
            </div>
          )}
        </Card>

        <div className="grid content-start gap-5">
          <Card as="div">
            <CardTitle hint="Automatic checks run on every save. The editorial read is the AI's opinion of the draft; neither is a promise of search performance.">Quality report</CardTitle>
            {q ? (
              <>
                <p className={cn("mt-3 text-[13.5px] font-medium", q.ok ? "text-success" : "text-warning")}>{q.ok ? "All blocking checks pass." : `${blocking.length} blocking check${blocking.length === 1 ? "" : "s"} need attention.`}</p>
                <ul className="mt-3 grid gap-1.5">
                  {q.checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-[13px]">
                      <span className="mt-0.5 shrink-0" aria-hidden>
                        {c.ok ? <Check className="h-4 w-4 text-success" /> : <AlertTriangle className={cn("h-4 w-4", c.critical ? "text-destructive" : "text-warning")} />}
                      </span>
                      <span>
                        <span className={cn(!c.ok && "font-medium")}>{c.label}</span>
                        {!c.ok && c.critical && <span className="sr-only"> (blocks publishing)</span>}
                        {c.note && <span className="block text-[12.5px] text-muted-foreground">{c.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                {q.editorNote && <p className="mt-3 rounded-xl bg-secondary/60 p-3 text-[12.5px] leading-relaxed">{q.editorNote}</p>}
              </>
            ) : (
              <p className="mt-3 text-[13.5px] text-muted-foreground">No report yet. Save once to run the checks.</p>
            )}
          </Card>
          <Card as="div">
            <CardTitle>Trail</CardTitle>
            <dl className="mt-3 grid gap-1.5 text-[13px]">
              <Row k="Author" v={post.author} />
              <Row k="Outlly tie-in" v={post.featureTieIn || "None (nothing fitted naturally)"} />
              <Row k="Reviewed by" v={post.reviewedBy || "Nobody yet"} />
              <Row k="Published" v={post.publishedAt ? `${fmtDate(post.publishedAt, true)} by ${post.publishedBy}` : "Not yet"} />
              {post.rejectReason && <Row k="Rejected" v={post.rejectReason} />}
              {post.jobId && (
                <Row
                  k="Run"
                  v={
                    <Link href="/admin/blog/generate" className="underline underline-offset-4">
                      See generation history
                    </Link>
                  }
                />
              )}
            </dl>
          </Card>
        </div>
      </div>

      <ConfirmDialog open={confirm === "publish"} onOpenChange={(o) => !o && setConfirm(null)} title="Approve and publish this article?" body={`It goes live at ${siteUrl}/blog/${d.slug} right away and joins the sitemap. You can unpublish later.`} confirmLabel="Approve & Publish" cancelLabel="Not yet" tone="primary" busy={busy === "publish"} onConfirm={() => act("publish")} />
      <ConfirmDialog
        open={confirm === "reject"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Reject this article?"
        body="It leaves the review queue and its topic is marked as skipped. You can restore it later."
        confirmLabel="Reject"
        busy={busy === "reject"}
        onConfirm={() => act("reject", { reason })}
        extra={
          <div className="grid gap-1.5">
            <Label htmlFor="rj">Reason (kept in the trail)</Label>
            <Input id="rj" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. too close to last week's article" />
          </div>
        }
      />
      <ConfirmDialog
        open={confirm === "rewrite"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Rewrite the whole article?"
        body="Starts a new run on the same topic: fresh research, outline and text. This draft is marked as replaced when the new one lands."
        confirmLabel="Start rewrite"
        tone="primary"
        busy={busy === "rewrite"}
        onConfirm={rewrite}
        extra={
          <div className="grid gap-1.5">
            <Label htmlFor="rw">What should be different (optional)</Label>
            <Input id="rw" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. focus on YouTube Shorts, not Reels" />
          </div>
        }
      />
    </div>
  );
}

function Field({ label, id, hint, counter, children }: { label: string; id: string; hint?: string; counter?: [number, number]; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {counter && (
          <span className={cn("text-[12px] tabular-nums", counter[0] > counter[1] ? "text-warning" : "text-muted-foreground")} aria-live="polite">
            {counter[0]}/{counter[1]}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
function toPatch(p: BlogPostView): BlogPostPatch {
  return { title: p.title, seoTitle: p.seoTitle, metaDescription: p.metaDescription, excerpt: p.excerpt, bodyMd: p.bodyMd, category: p.category, tags: p.tags, primaryKeyword: p.primaryKeyword, secondaryKeywords: p.secondaryKeywords, slug: p.slug, internalLinks: p.internalLinks };
}
