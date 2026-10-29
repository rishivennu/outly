import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { invoicePdf } from "@/lib/billing/invoice";
import { creditNotePdf } from "@/lib/billing/credit-note";
import { readDocs } from "@/lib/pip/links";
import { zip } from "@/lib/pip/zip";

export const dynamic = "force-dynamic";

/**
 * Pip's download links (1049). The signed token names the documents and expires in 10 minutes, AND the
 * session must be that same owner (not a teammate), AND every document is re-checked against the database.
 * One document: the PDF. Several: a ZIP, with MISSING.txt naming any that couldn't be included.
 */
const notFound = () => new Response("This link has expired or isn't yours. Ask Pip for a fresh one.", { status: 404, headers: { "cache-control": "private, no-store" } });

export async function GET(req: NextRequest) {
  const claims = readDocs(req.nextUrl.searchParams.get("t") ?? "");
  if (!claims) return notFound();
  const user = await getCurrentUser();
  if (!user || user.actor || user.id !== claims.userId) return notFound();

  const invNums = claims.docs.filter((d) => d.kind === "inv").map((d) => d.number);
  const cnNums = claims.docs.filter((d) => d.kind === "cn").map((d) => d.number);
  const [invs, cns] = await Promise.all([
    invNums.length ? db.invoice.findMany({ where: { number: { in: invNums }, userId: user.id }, select: { id: true, number: true, issuedAt: true } }) : [],
    cnNums.length ? db.creditNote.findMany({ where: { number: { in: cnNums }, userId: user.id }, select: { id: true, number: true, issuedAt: true } }) : [],
  ]);
  const files: { name: string; data: Uint8Array; date: Date }[] = [];
  const missing: string[] = [];
  for (const d of claims.docs) {
    const row = d.kind === "inv" ? invs.find((x) => x.number === d.number) : cns.find((x) => x.number === d.number);
    if (!row) {
      missing.push(`${d.number}: not found on your account`);
      continue;
    }
    try {
      const pdf = d.kind === "inv" ? await invoicePdf(row.id) : await creditNotePdf(row.id);
      files.push({ name: `${d.number}.pdf`, data: new Uint8Array(pdf), date: row.issuedAt });
    } catch {
      missing.push(`${d.number}: the PDF couldn't be made just now, try again`);
    }
  }

  await db.pipAccessLog
    .create({ data: { userId: user.id, actorId: null, tool: "download", args: JSON.stringify({ docs: claims.docs.length }), found: files.length, complete: missing.length === 0 } })
    .catch(() => {});

  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (claims.docs.length === 1) {
    if (!files[0])
      return missing[0]?.includes("couldn't be made")
        ? new Response("This PDF couldn't be made just now. Try the link again in a minute.", { status: 503, headers: { ...headers, "retry-after": "60" } })
        : notFound();
    return new Response(files[0].data, { headers: { ...headers, "content-type": "application/pdf", "content-disposition": `attachment; filename="${files[0].name}"` } });
  }
  if (!files.length) return notFound();
  if (missing.length) files.push({ name: "MISSING.txt", data: new TextEncoder().encode(`These couldn't be included:\r\n${missing.join("\r\n")}\r\n`), date: new Date() });
  const body = zip(files);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(body), {
    headers: { ...headers, "content-type": "application/zip", "content-disposition": `attachment; filename="outlly-documents-${stamp}.zip"` },
  });
}
