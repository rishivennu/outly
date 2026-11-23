import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { json } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { CALENDAR_STATE_COOKIE as STATE_COOKIE, CalendarError, calendarConnectUrl, calendarStatus, disconnectCalendar } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

/** R1309: the Google Calendar connection for workshops. State cookie: same pattern as the social connects. */

export const GET = adminRoute("integrations", async (req: NextRequest) => {
  if (req.nextUrl.searchParams.get("status") === "1") return json(await calendarStatus());
  try {
    const state = randomToken(16);
    (await cookies()).set(STATE_COOKIE, state, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/api/admin/integrations/google", maxAge: 600 });
    return NextResponse.redirect(await calendarConnectUrl(state));
  } catch (e) {
    const msg = e instanceof CalendarError ? e.message : "Couldn't start the Google connection.";
    return NextResponse.redirect(new URL(`/admin/integrations?gcal=error&reason=${encodeURIComponent(msg)}`, env.APP_URL));
  }
});

export const DELETE = adminRoute("integrations", async (_req, { admin }) => {
  await disconnectCalendar();
  await adminEvent("integration", `${admin.name} disconnected Google Calendar`, undefined, "/admin/integrations");
  return json(await calendarStatus());
});
