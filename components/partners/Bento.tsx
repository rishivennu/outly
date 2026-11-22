import { OutllyLogoIcon } from "@/components/brand/OutllyBrand";
import { Reveal } from "@/components/marketing/Reveal";
import { Shell } from "@/components/marketing/bits";
import { PartnersMotion } from "./Motion";
import s from "./bento.module.css";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

function Tile({
  cell,
  tone,
  title,
  body,
  copyAt,
  delay,
  children,
}: {
  cell: string;
  tone: string;
  title: string;
  body: string;
  copyAt: "top" | "bottom";
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <Reveal as="li" delay={delay} className={cx(s.cell, cell)}>
      <article className={cx(s.tile, tone)} data-tile data-tilt>
        <div className={cx(s.copy, copyAt === "top" ? s.copyTop : s.copyBottom)}>
          <h3 className={cx("display", s.title)}>{title}</h3>
          <p className={s.body}>{body}</p>
        </div>
        {children}
      </article>
    </Reveal>
  );
}

function OfferMock() {
  return (
    <div aria-hidden="true" className={cx(s.mock, s.mockA)} data-anim="offer">
      <div className={cx(s.card, s.brief, s.float, s.floatSlow)} data-p="brief">
        <span className={s.briefHead}>Campaign brief</span>
        {["Hook in the first 2 seconds", "Show the caption editor", "Tag @outlly in the post"].map((t) => (
          <span key={t} className={s.check} data-p="check">
            <span className={s.tick} />
            {t}
          </span>
        ))}
      </div>
      <div className={cx(s.card, s.offer, s.float)} data-p="offer">
        <span className={s.offerHead}>Offer for Maya Rao</span>
        <span className={s.row}>
          <span className={s.key}>Campaign</span>
          <span className={s.val}>Reels series x3</span>
        </span>
        <span className={s.row}>
          <span className={s.key}>Fee</span>
          <span className={s.val}>agreed per campaign</span>
        </span>
        <span className={s.row}>
          <span className={s.key}>Deadline</span>
          <span className={s.val}>Oct 20</span>
        </span>
        <span className={s.accept} data-p="accept">
          Accept offer
        </span>
      </div>
    </div>
  );
}

function PlanMock() {
  return (
    <div aria-hidden="true" className={cx(s.mock, s.mockB)} data-anim="plan">
      <div className={cx(s.card, s.planBack)} data-p="planBack" />
      <div className={cx(s.card, s.plan, s.float)} data-p="plan">
        <span className={s.planLabel}>Creator plan</span>
        <span className={cx("display", s.planBig)} data-p="planBig">
          2 months
        </span>
        <span className={s.planSub}>on us</span>
        <span className={s.planCheck}>
          <span className={s.tickLime} />
          Captions, scheduling, analytics
        </span>
      </div>
    </div>
  );
}

function WalletMock() {
  return (
    <div aria-hidden="true" className={cx(s.mock, s.mockC)} data-anim="wallet">
      <div className={cx(s.walletGroup, s.float)}>
        <span className={s.peek} data-p="peek" />
        <div className={cx(s.card, s.wallet)} data-p="wallet">
          <span className={s.walletLabel}>Partner balance</span>
          <span className={s.walletFoot}>
            <span className={s.amount}>
              <span className={s.cur}>$</span> 420.00
            </span>
            <span className={s.payout}>Request payout</span>
          </span>
        </div>
        <div className={s.stats}>
          {[
            ["Signups", "128"],
            ["Paid", "31"],
            ["Rate", "24%"],
          ].map(([k, v]) => (
            <span key={k} className={s.stat} data-p="stat">
              <span className={s.statK}>{k}</span>
              <span className={s.statV}>{v}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const INBOX = [
  { who: "Outlly team", initials: "OT", text: "Brief approved", date: "Nov 3", tone: "lime" },
  { who: "Maya Rao", initials: "MR", text: "Reel 2 uploaded", date: "Nov 5", tone: "mint" },
  { who: "Outlly team", initials: "OT", text: "Payout sent", date: "Nov 9", tone: "lime" },
] as const;

function InboxMock() {
  return (
    <div aria-hidden="true" className={cx(s.mock, s.mockD)} data-anim="inbox">
      <div className={cx(s.card, s.inbox, s.float, s.floatSlow)}>
        {INBOX.map((m) => (
          <span key={m.text} className={s.msg} data-p="msg">
            <span className={cx(s.avatar, m.tone === "lime" ? s.avatarLime : s.avatarMint)}>{m.initials}</span>
            <span className={s.msgText}>
              <span className={s.msgWho}>{m.who}</span>
              <span className={s.msgLine}>
                {m.text} <span className={s.msgDate}>{m.date}</span>
              </span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

const PLATFORMS = [
  { name: "Reels", cls: s.pReels },
  { name: "Shorts", cls: s.pShorts },
  { name: "X", cls: s.pX },
  { name: "YouTube", cls: s.pYouTube },
  { name: "TikTok", cls: s.pTikTok },
  { name: "LinkedIn", cls: s.pLinkedIn },
];

function FanMock() {
  return (
    <div aria-hidden="true" className={cx(s.mock, s.mockE)} data-anim="fan">
      <div className={cx(s.fan, s.float)}>
        {PLATFORMS.map((p) => (
          <span key={p.name} className={cx(s.pcard, p.cls)} data-p="pcard">
            {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function PhoneMock() {
  return (
    <div aria-hidden="true" className={cx(s.mock, s.mockF)} data-anim="phone">
      <div className={cx(s.phone, s.float, s.floatSlow)} data-p="phone">
        <div className={s.screen}>
          <span className={s.status}>
            <span>9:41</span>
            <span className={s.notch} />
            <span className={s.bars} />
          </span>
          <span className={s.notif} data-p="notif">
            <span className={s.appMark}>
              <OutllyLogoIcon size={18} tone="dark" />
            </span>
            <span className={s.notifText}>
              <span className={s.notifApp}>Outlly Partners</span>
              <span className={s.notifBody}>Reel 2 is due Friday. Open your portal.</span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function PartnersBento() {
  return (
    <section id="what" aria-labelledby="partners-what" className="scroll-mt-24 pb-10 pt-16 sm:pb-12 sm:pt-24">
      <Shell>
        <Reveal y={0} className="max-w-2xl">
          <p className="eyebrow mb-5">What partnering looks like</p>
          <h2 id="partners-what" className="display text-balance text-[clamp(2rem,2.4vw+1rem,3rem)]">
            Six things you get, <span className="accent-serif">in plain words.</span>
          </h2>
          <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
            Every partnership comes with the same six things, written out before you post a single frame.
          </p>
        </Reveal>
        <ul className={s.grid}>
          <Tile
            cell={s.a}
            tone={s.mint}
            copyAt="top"
            delay={0}
            title="Paid collaborations"
            body="Compensation agreed per campaign, written out before you start. Reach, quality, format and scope set the number."
          >
            <OfferMock />
          </Tile>
          <Tile
            cell={s.b}
            tone={s.deep}
            copyAt="bottom"
            delay={0.06}
            title="Complimentary Creator plan"
            body="One to two months of the Creator plan to make content with. Ongoing partners get it extended."
          >
            <PlanMock />
          </Tile>
          <Tile
            cell={s.c}
            tone={s.moss}
            copyAt="bottom"
            delay={0.12}
            title="Track what you earn"
            body="Every referral, signup and payout in one place."
          >
            <WalletMock />
          </Tile>
          <Tile
            cell={s.d}
            tone={s.lime}
            copyAt="top"
            delay={0.18}
            title="Your portal"
            body="Briefs, deliverables and feedback, without the email chain."
          >
            <InboxMock />
          </Tile>
          <Tile
            cell={s.e}
            tone={s.night}
            copyAt="bottom"
            delay={0.06}
            title="Content that fits every platform"
            body="Reels, Shorts, X posts, YouTube: one upload, each destination gets its own cut and caption."
          >
            <FanMock />
          </Tile>
          <Tile
            cell={s.f}
            tone={s.mint}
            copyAt="top"
            delay={0.12}
            title="We remind, you create"
            body="Deadlines and payouts as notifications, so nothing slips."
          >
            <PhoneMock />
          </Tile>
        </ul>
        <p className="mt-6 max-w-2xl text-pretty text-[14px] leading-relaxed text-muted-foreground">
          Every offer is agreed individually after review. Applying does not guarantee payment or a subscription.
        </p>
      </Shell>
      <PartnersMotion root="what" />
    </section>
  );
}
