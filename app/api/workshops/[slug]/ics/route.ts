import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { icsText } from "@/lib/workshops/core";
import { workshopUrl } from "@/lib/workshops/server";

export const dynamic = "force-dynamic";

/** The .ics download for a published workshop. The Meet link is included only for a registered, signed-in creator. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const w = await db.workshop.findUnique({ where: { slug } });
  if (!w || w.status === "draft") return new NextResponse("Not found", { status: 404 });
  const user = await getCurrentUser().catch(() => null);
  const mine = user ? await db.workshopRegistration.findUnique({ where: { workshopId_email: { workshopId: w.id, email: user.email.toLowerCase() } } }) : null;
  const body = icsText({ uid: `workshop-${w.id}`, title: w.title, summary: w.summary, startsAt: w.startsAt, endsAt: w.endsAt, url: workshopUrl(w.slug), meetUrl: mine?.status === "registered" ? w.meetUrl || undefined : undefined, cancelled: w.status === "cancelled" });
  return new NextResponse(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="outlly-${w.slug}.ics"`, "cache-control": "private, no-store" } });
}
