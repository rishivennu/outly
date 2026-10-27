import { destroySession } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { forgetThisDevice } from "@/lib/push/device";

export const POST = route(async () => {
  await forgetThisDevice();
  destroySession();
  return json({ ok: true });
}, { auth: false });
