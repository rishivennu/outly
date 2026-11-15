import "server-only";
import { db } from "./db";
import { realUserId, type SessionUser } from "./auth";
import { PLATFORMS, PLATFORM_META } from "./domain";
import { isProfileImg } from "./profile-card-core";
import { canConnectWithToken, hasCredentials, isPracticeAccount, loadKeys, practiceAllowed } from "./social/registry";
import { applyOnboarding, mergeOnboarding, parseOnboarding, serializeOnboarding, type ConnectHow, type ConnectOption, type OnboardingFacts, type OnboardingPatch, type OnboardingPayload, type OnboardingView } from "./onboarding-core";

type Who = Pick<SessionUser, "id" | "actor">;

async function read(user: Who) {
  const [accounts, media, post, owner, me] = await Promise.all([
    db.socialAccount.findMany({ where: { userId: user.id, status: { not: "disconnected" } }, orderBy: { createdAt: "asc" }, select: { platform: true, platformUserId: true, status: true, username: true } }),
    db.media.findFirst({ where: { userId: user.id }, select: { id: true } }),
    db.post.findFirst({ where: { userId: user.id, OR: [{ launchedAt: { not: null } }, { status: { in: ["scheduled", "published", "partial"] } }] }, select: { id: true } }),
    db.user.findUnique({ where: { id: user.id }, select: { name: true, niche: true, bio: true, handle: true, avatar: true } }),
    db.user.findUnique({ where: { id: realUserId(user) }, select: { onboarding: true } }),
  ]);
  const facts: OnboardingFacts = {
    owner: !user.actor,
    connected: accounts.some((a) => a.status === "connected" && !isPracticeAccount(a)),
    profile: !!(owner?.niche?.trim() || owner?.bio?.trim() || owner?.handle?.trim() || isProfileImg(owner?.avatar, "avatar")),
    uploaded: !!media,
    scheduled: !!post,
  };
  return { accounts, owner, facts, saved: parseOnboarding(me?.onboarding) };
}

async function payload(user: Who, r: Awaited<ReturnType<typeof read>>, view: OnboardingView): Promise<OnboardingPayload> {
  let connect: ConnectOption[] | null = null;
  if (r.facts.owner) {
    await loadKeys();
    connect = PLATFORMS.map((p): ConnectOption => {
      const a = r.accounts.find((x) => x.platform === p);
      const how: ConnectHow = hasCredentials(p) ? "oauth" : canConnectWithToken(p) ? "token" : practiceAllowed() ? "practice" : "later";
      return {
        platform: p,
        name: PLATFORM_META[p].name,
        how,
        status: a ? (a.status === "needs_reconnect" ? "needs_reconnect" : "connected") : null,
        username: a?.username ?? null,
        practice: !!a && isPracticeAccount(a),
      };
    }).sort((x, y) => Number(x.how === "later" && !x.status) - Number(y.how === "later" && !y.status));
  }
  const profile = r.facts.owner && r.owner ? { name: r.owner.name, niche: r.owner.niche, avatar: r.owner.avatar, hasPhoto: isProfileImg(r.owner.avatar, "avatar") } : null;
  return { ...view, connect, profile };
}

/** The merged state for Home, Help and the API. Stored on the person signed in, facts from the workspace. */
export async function onboardingFor(user: Who): Promise<OnboardingPayload> {
  const r = await read(user);
  return payload(user, r, mergeOnboarding(r.saved, r.facts));
}

export async function updateOnboarding(user: Who, patch: OnboardingPatch, now = new Date()): Promise<OnboardingPayload> {
  const r = await read(user);
  const saved = applyOnboarding(r.saved, patch, r.facts, now);
  await db.user.update({ where: { id: realUserId(user) }, data: { onboarding: serializeOnboarding(saved) } });
  return payload(user, r, mergeOnboarding(saved, r.facts));
}
