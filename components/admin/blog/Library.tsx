"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { BlogPostView } from "@/lib/blog/types";
import { Card, Empty, Pill, Table, fmtDate } from "../ui";
import { SearchInput } from "../SearchInput";

const FILTERS = [
  ["all", "All"],
  ["pending", "Pending approval"],
  ["approved", "Approved"],
  ["published", "Published"],
  ["rejected", "Rejected"],
] as const;
const TONE: Record<string, "ok" | "warn" | "bad" | "muted" | "info"> = { pending: "warn", approved: "info", published: "ok", rejected: "bad" };
const LABEL: Record<string, string> = { pending: "Pending", approved: "Approved", published: "Published", rejected: "Rejected" };

/** R1175 Blog library: every article the agent wrote, filterable, each row opening the review desk. */
export function Library({ posts }: { posts: BlogPostView[] }) {
  const [f, setF] = useState<(typeof FILTERS)[number][0]>("all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return posts.filter((p) => (f === "all" || p.status === f) && (!s || p.title.toLowerCase().includes(s) || p.primaryKeyword.includes(s) || p.category.toLowerCase().includes(s) || p.slug.includes(s)));
  }, [posts, f, q]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, k === "all" ? posts.length : posts.filter((p) => p.status === k).length])), [posts]);
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Status filter" className="flex flex-wrap gap-1 rounded-full bg-secondary p-1">
          {FILTERS.map(([k, label]) => (
            <button key={k} role="tab" type="button" aria-selected={f === k} onClick={() => setF(k)} className={cn("min-h-11 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", f === k ? "bg-card shadow-sm" : "text-muted-foreground")}>
              {label} <span className="tabular-nums text-muted-foreground">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="w-full sm:w-72">
          <SearchInput value={q} onChange={setQ} placeholder="Search title, keyword, category" />
        </div>
      </div>
      <div className="mt-4">
        {rows.length ? (
          <Table head={["Article", "Category", "Keyword", "Status", "Quality", "Words", "Created", "Published"]} label="Blog library" minWidth={900}>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="max-w-[36ch]">
                  <Link href={`/admin/blog/review/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                    {p.title}
                  </Link>
                  <span className="block truncate text-[12px] text-muted-foreground">/blog/{p.slug}</span>
                </td>
                <td>{p.category}</td>
                <td className="max-w-[20ch] truncate">{p.primaryKeyword}</td>
                <td>
                  {/* R1178: an approved article with a date is waiting for that moment; without one it waits for a person. */}
                  {p.status === "approved" && p.scheduledFor ? <Pill tone="info">Scheduled {fmtDate(p.scheduledFor, true)}</Pill> : <Pill tone={TONE[p.status] ?? "muted"}>{LABEL[p.status] ?? p.status}</Pill>}
                </td>
                <td>
                  <Pill tone={p.qualityOk ? "ok" : "warn"}>{p.qualityOk ? "Passes" : "Needs attention"}</Pill>
                </td>
                <td className="tabular-nums">{p.wordCount}</td>
                <td>{fmtDate(p.createdAt)}</td>
                <td>{p.publishedAt ? fmtDate(p.publishedAt) : "Not yet"}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title={posts.length ? "Nothing matches" : "No articles yet"} body={posts.length ? "Try another filter or search." : "Generate the first one from Generate blog."}>
            {!posts.length && (
              <Link href="/admin/blog/generate" className="mt-2 underline underline-offset-4">
                Go to Generate blog
              </Link>
            )}
          </Empty>
        )}
      </div>
    </Card>
  );
}
