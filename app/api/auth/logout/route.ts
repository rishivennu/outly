import { endSession } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { forgetThisDevice } from "@/lib/push/device";
import { forgetThisBrowser } from "@/lib/trusted-device";

export const POST = route(async () => {
  await forgetThisDevice();
  await forgetThisBrowser(); // signing out also un-remembers this device (1053)
  await endSession(); // 1080: its Active sessions row goes too
  return json({ ok: true });
}, { auth: false });
