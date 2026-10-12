import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Lets the chat widget prefill the email on any page without making every layout dynamic. */
export async function GET() {
  const u = await getCurrentUser().catch(() => null);
  return NextResponse.json(u ? { name: u.name, email: u.email } : null, { headers: { "cache-control": "private, no-store" } });
}
