import { destroySession } from "@/lib/auth";
import { json, route } from "@/lib/http";

export const POST = route(async () => {
  destroySession();
  return json({ ok: true });
}, { auth: false });
