import { renewSession } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { meBody } from "@/lib/me";
import { nativeClient } from "@/lib/native-client";

export const dynamic = "force-dynamic";

/** Who is signed in, for the app's first screen. The app calls this on every launch, which also keeps its session fresh. */
export const GET = route(async (req, { user }) => {
  const app = nativeClient(req);
  const renewed = app ? await renewSession() : false;
  return json({ ...meBody(user, !!app), renewed });
});
