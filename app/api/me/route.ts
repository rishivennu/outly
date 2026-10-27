import { APP_SELLS_PLANS } from "@/lib/app-mode";
import { realUserId, renewSession } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { nativeClient } from "@/lib/native-client";
import { pushConfigured } from "@/lib/push/fcm";

export const dynamic = "force-dynamic";

/** Who is signed in, for the app's first screen. The app calls this on every launch, which also keeps its session fresh. */
export const GET = route(async (req, { user }) => {
  const app = nativeClient(req);
  const renewed = app ? await renewSession() : false;
  return json({
    user: { id: realUserId(user), name: user.actor?.name ?? user.name, email: user.actor?.email ?? user.email, avatar: user.actor ? null : user.avatar, timezone: user.timezone, joinedAt: user.joinedAt },
    workspace: user.actor ? { ownerId: user.id, ownerName: user.name, ownerAvatar: user.avatar, role: user.role } : null,
    role: user.role,
    features: { sellsPlans: app ? APP_SELLS_PLANS : true, push: pushConfigured() },
    renewed,
  });
});
