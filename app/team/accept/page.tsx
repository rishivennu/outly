import Link from "next/link";
import { Pip } from "@/components/brand/Pip";
import { OutlyLogo } from "@/components/brand/Logo";
import { db } from "@/lib/db";
import { readSessionUserId } from "@/lib/auth";
import { inviteByToken } from "@/lib/team/service";
import { ROLE_INFO, type TeamRole } from "@/lib/team/roles";
import { AcceptInvite } from "@/components/team/AcceptInvite";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team invite", robots: { index: false } };

const btn = "inline-flex h-12 items-center justify-center rounded-full px-6 text-[15px] font-semibold transition-transform hover:-translate-y-px focus-visible:outline-2";

/** Landing page of an invite email. Works signed out: signup and login both come back here. */
export default async function AcceptPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  const invite = token.length >= 10 ? await inviteByToken(token) : null;
  const meId = await readSessionUserId();
  const me = meId ? await db.user.findUnique({ where: { id: meId }, select: { id: true, email: true, name: true } }) : null;
  const back = `/team/accept?token=${encodeURIComponent(token)}`;
  const role = invite ? ROLE_INFO[invite.role as TeamRole] ?? ROLE_INFO.editor : null;

  let body: React.ReactNode;
  if (!invite || !role) {
    body = (
      <>
        <h1 className="display mt-2 text-[clamp(2rem,6vw,2.8rem)]">This invite isn&apos;t valid.</h1>
        <p className="mt-3 text-muted-foreground">It may have been cancelled or replaced by a newer one. Ask whoever invited you to send it again.</p>
        <Link href={me ? "/home" : "/"} className={`${btn} mt-8 bg-secondary`}>{me ? "Go to my studio" : "Go to Outlly"}</Link>
      </>
    );
  } else if (invite.expired) {
    body = (
      <>
        <h1 className="display mt-2 text-[clamp(2rem,6vw,2.8rem)]">This invite expired.</h1>
        <p className="mt-3 text-muted-foreground">Invites last 14 days. Ask {invite.owner.name} to send a new one from Settings.</p>
      </>
    );
  } else {
    const intro = (
      <>
        <h1 className="display mt-2 text-[clamp(2rem,6vw,2.8rem)]">{invite.owner.name} invited you to their studio.</h1>
        <p className="mt-3 text-muted-foreground">
          You&apos;d join as <b className="text-foreground">{role.label.toLowerCase()}</b>. {role.blurb}
        </p>
      </>
    );
    if (!me) {
      body = (
        <>
          {intro}
          <p className="mt-4 text-sm text-muted-foreground">Use <b className="text-foreground">{invite.email}</b> so we can match the invite to you.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={`/signup?next=${encodeURIComponent(back)}`} className={`${btn} lime-bg`}>Create my account</Link>
            <Link href={`/login?next=${encodeURIComponent(back)}`} className={`${btn} bg-secondary`}>I already have one</Link>
          </div>
        </>
      );
    } else if (me.id === invite.ownerId) {
      body = (
        <>
          <h1 className="display mt-2 text-[clamp(2rem,6vw,2.8rem)]">That&apos;s your own invite.</h1>
          <p className="mt-3 text-muted-foreground">Send this link to {invite.email}. It works for 14 days.</p>
          <Link href="/settings#team" className={`${btn} mt-8 bg-secondary`}>Back to Team settings</Link>
        </>
      );
    } else if (me.email.toLowerCase() !== invite.email.toLowerCase()) {
      body = (
        <>
          {intro}
          <p role="alert" className="mt-5 rounded-2xl bg-warning/15 p-4 text-sm">
            This invite is for <b>{invite.email}</b>, but you&apos;re signed in as <b>{me.email}</b>. Sign out and sign in with {invite.email}, or ask for an invite to this address.
          </p>
          <Link href="/settings" className={`${btn} mt-6 bg-secondary`}>Go to Settings to sign out</Link>
        </>
      );
    } else {
      body = (
        <>
          {intro}
          <AcceptInvite token={token} owner={invite.owner.name} />
        </>
      );
    }
  }

  return (
    <main id="main" className="relative grid min-h-dvh place-items-center overflow-hidden px-6 py-16">
      <div aria-hidden className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_50%_at_50%_0%,hsl(var(--lime)/0.14),transparent_70%)]" />
      <div className="admin-page-in relative flex w-full max-w-md flex-col items-center text-center">
        <OutlyLogo size={30} />
        <div className="mt-10"><Pip size={104} mood="happy" /></div>
        <p className="eyebrow mt-6">Team invite</p>
        {body}
      </div>
    </main>
  );
}
