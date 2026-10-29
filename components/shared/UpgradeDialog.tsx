"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pip } from "@/components/brand/Pip";
import { useUser } from "@/components/shell/UserContext";
import { UPGRADE_EVENT, type UpgradeDetail } from "@/lib/client/api";
import { APP_SELLS_PLANS } from "@/lib/app-mode";
import { useAppMode } from "@/lib/client/app-mode";

const TITLE: Record<string, string> = {
  posts: "Upgrade to post more",
  upload: "Upgrade to upload bigger videos",
  replies: "Upgrade to reply to more people",
  captions: "Upgrade for more AI captions",
  burn: "Upgrade to burn captions in",
  ai: "Upgrade for AI captions",
  seats: "Upgrade to add your team",
  accounts: "Upgrade to connect more accounts",
  storage: "Upgrade for more storage",
};

/**
 * One popup for every plan limit. Any 402 PLAN_LIMIT from the API (see lib/client/api.ts) opens it with the
 * server's own message, so the reason is always the real one. Members of someone else's workspace can't
 * reach Billing, so they're told to ask the owner instead.
 */
export function UpgradeDialog() {
  const user = useUser();
  const [d, setD] = useState<UpgradeDetail | null>(null);
  useEffect(() => {
    const on = (e: Event) => setD((e as CustomEvent<UpgradeDetail>).detail);
    window.addEventListener(UPGRADE_EVENT, on);
    return () => window.removeEventListener(UPGRADE_EVENT, on);
  }, []);
  const open = !!d;
  const member = !!user.workspace;
  // The Android app can't sell plans (Google Play billing rules), so it explains the limit without a way to buy.
  const sells = !useAppMode() || APP_SELLS_PLANS;
  const title = sells ? (d?.feature && TITLE[d.feature]) || TITLE.posts : "You've reached your plan's limit";

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && setD(null)}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[80] bg-foreground/35 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            {/* flex-col + my-auto, not grid place-items: a tall card still scrolls from its top on short phones. */}
            <Dialog.Content asChild forceMount>
              <div
                className="fixed inset-0 z-[81] flex flex-col overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                data-lenis-prevent
                onPointerDown={(e) => { if (e.target === e.currentTarget) setD(null); }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="glass-strong mx-auto my-auto w-full max-w-[420px] rounded-[28px] p-5 text-center sm:p-6"
                >
                  <Pip size={64} mood="idle" className="mx-auto" />
                  <Dialog.Title className="mt-3 text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</Dialog.Title>
                  <Dialog.Description className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {d?.message}
                    {member && sells && " Only the workspace owner can change the plan, so ask them to upgrade."}
                  </Dialog.Description>
                  <div className="mt-6 flex flex-wrap-reverse gap-2">
                    <Dialog.Close asChild>
                      <Button variant="ghost" className="min-w-[8rem] flex-1">Not now</Button>
                    </Dialog.Close>
                    {!member && sells && (
                      <Button asChild variant="lime" className="min-w-[8rem] flex-1">
                        <Link href="/billing#plans" onClick={() => setD(null)} autoFocus>
                          <Sparkles className="h-4 w-4" aria-hidden /> See plans
                        </Link>
                      </Button>
                    )}
                  </div>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
