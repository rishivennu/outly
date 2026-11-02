"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { SWITCH_HELP } from "@/lib/social/switch-help";
import type { ChoiceView } from "@/lib/connect-choice";

/** The exact question (1095) for an account this studio has had before. */
export const KNOWN_QUESTION = "This account was previously connected to Outlly. Would you like to reconnect this account or connect a different account?";

const at = (u: string) => (/^@/.test(u) || /\s/.test(u) ? u : `@${u}`);
const list = (xs: { username: string }[]) => xs.map((x) => at(x.username)).join(", ");

/** The copy for each kind of question, kept pure so tests can read it. */
export function choiceCopy(c: Pick<ChoiceView, "platform" | "account" | "decision">) {
  const name = PLATFORM_META[c.platform].name;
  const who = at(c.account.username);
  const d = c.decision;
  const replaceNote = d.replaces.length ? `Your plan connects one ${name} account at a time, so this disconnects ${list(d.replaces)}. Its published posts and their numbers stay.` : null;
  if (d.kind === "known") {
    const notes = [
      d.expected && d.expected.id !== d.existing.id ? `You were reconnecting ${at(d.expected.username)}, but ${name} signed you in as ${who}.` : null,
      d.again ? `${name} signed you in as ${who} again. ${SWITCH_HELP[c.platform].picker ? "Pick another account on the next screen." : "Sign out of it on " + name + " first (or use a private window), then try again."}` : null,
      replaceNote,
    ].filter(Boolean) as string[];
    return { title: `${name} signed you in as ${who}`, body: KNOWN_QUESTION, notes, save: "Reconnect Existing Account", other: "Connect a Different Account" };
  }
  if (d.kind === "mismatch") {
    return {
      title: `That's a different ${name} account`,
      body: `You were reconnecting ${at(d.expected.username)}, but ${name} signed you in as ${who}. Nothing is saved until you choose.`,
      notes: [replaceNote ?? `${who} would be added next to your other ${name} accounts.`],
      save: `Connect ${who}`,
      other: `Sign in as ${at(d.expected.username)} instead`,
    };
  }
  return {
    title: `Replace ${list(d.replaces)} with ${who}?`,
    body: `${name} signed you in as ${who}. Nothing is saved until you choose.`,
    notes: [replaceNote!],
    save: `Replace ${list(d.replaces)}`,
    other: `Keep ${list(d.replaces)}`,
  };
}

function Shell({ open, onClose, busy, children }: { open: boolean; onClose: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[70] bg-foreground/35 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <div className="fixed inset-0 z-[71] grid place-items-center overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" data-lenis-prevent>
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                  className="glass-strong relative w-full max-w-[460px] rounded-[28px] p-5 motion-reduce:transition-none sm:p-6"
                >
                  {children}
                  <Dialog.Close asChild>
                    <button type="button" disabled={busy} aria-label="Close" className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </Dialog.Close>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/**
 * After a sign-in that needs the creator's say: reconnect the account it found, or go and connect a different
 * one. Closing it (X, Escape, outside) counts as "not this one": the held sign-in is thrown away.
 */
export function ConnectChoiceDialog({ choice, busy, onSave, onOther, onClose }: { choice: ChoiceView | null; busy: boolean; onSave: () => void; onOther: () => void; onClose: () => void }) {
  const copy = choice ? choiceCopy(choice) : null;
  return (
    <Shell open={!!choice} onClose={onClose} busy={busy}>
      {choice && copy && (
        <>
          <div className="flex items-center gap-3 pr-10">
            <PlatformOrb platform={choice.platform} size={40} />
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">{copy.title}</Dialog.Title>
              {choice.account.displayName && choice.account.displayName !== choice.account.username && <p className="truncate text-sm text-muted-foreground">{choice.account.displayName}</p>}
            </div>
          </div>
          <Dialog.Description className="mt-4 text-[15px] leading-relaxed">{copy.body}</Dialog.Description>
          {copy.notes.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {copy.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="lime" className="min-h-11 flex-1" onClick={onSave} disabled={busy} autoFocus>
              {busy ? "Working…" : copy.save}
            </Button>
            <Button variant="ghost" className="min-h-11 flex-1 hairline" onClick={onOther} disabled={busy}>
              {copy.other}
            </Button>
          </div>
        </>
      )}
    </Shell>
  );
}

/**
 * Before sending someone to a platform that has no account picker for apps: say it will sign in whoever is
 * open in this browser, and offer the way out. Platforms with a picker skip this.
 */
export function SwitchGuideDialog({ platform, href, onClose }: { platform: Platform | null; href: string; onClose: () => void }) {
  const h = platform ? SWITCH_HELP[platform] : null;
  const name = platform ? PLATFORM_META[platform].name : "";
  return (
    <Shell open={!!platform} onClose={onClose}>
      {platform && h && (
        <>
          <div className="flex items-center gap-3 pr-10">
            <PlatformOrb platform={platform} size={40} />
            <Dialog.Title className="text-lg font-semibold tracking-tight">Use a different {name} account</Dialog.Title>
          </div>
          <Dialog.Description className="mt-4 text-[15px] leading-relaxed">{h.how}</Dialog.Description>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Sign out on {name}
              {h.signOutUrl && (
                <>
                  {" "}
                  (
                  <a href={h.signOutUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-medium text-foreground underline underline-offset-4 sm:min-h-0">
                    open {name} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  )
                </>
              )}
              , or open Outlly in a private window.
            </li>
            <li>Come back here and continue. You&apos;ll sign in as the account you want.</li>
          </ol>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <Button asChild variant="lime" className="min-h-11 flex-1">
              <a href={href}>Continue to {name}</a>
            </Button>
            <Button variant="ghost" className="min-h-11 flex-1 hairline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </Shell>
  );
}
