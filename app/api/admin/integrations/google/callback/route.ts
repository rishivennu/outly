import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAdmin } from "@/lib/admin/auth";
import { can } from "@/lib/admin/perms";
import { adminEvent } from "@/lib/admin/route";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { CALENDAR_STATE_COOKIE as STATE_COOKIE, CalendarError, finishCalendarConnect } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

const back = (q: string) => NextResponse.redirect(new URL(`/admin/integrations?${q}`, env.APP_URL));

/** Google sends the admin back here. Admin session + state cookie, then the code becomes the stored refresh token. */
export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin || !can(admin.role, "integrations")) return NextResponse.redirect(new URL("/admin/login?next=/admin/integrations", env.APP_URL));
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value ?? "";
  jar.delete({ name: STATE_COOKIE, path: "/api/admin/integrations/google" });
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const code = req.nextUrl.searchParams.get("code");
  const denied = req.nextUrl.searchParams.get("error");
  if (denied) return back(`gcal=error&reason=${encodeURIComponent(denied === "access_denied" ? "You closed the Google screen without allowing access." : denied)}`);
  if (!expected || !state || !safeEqual(expected, state)) return back("gcal=error&reason=" + encodeURIComponent("That connection attempt expired. Try again."));
  if (!code) return back("gcal=error&reason=" + encodeURIComponent("Google sent no code."));
  try {
    const cfg = await finishCalendarConnect(code);
    await adminEvent("integration", `${admin.name} connected Google Calendar`, cfg.google.email, "/admin/integrations");
    return back("gcal=connected");
  } catch (e) {
    const msg = e instanceof CalendarError ? e.message : "Google refused the connection.";
    return back(`gcal=error&reason=${encodeURIComponent(msg)}`);
  }
}
