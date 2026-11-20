"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { PARTNER_TRANSITIONS, type PartnerStatus } from "@/lib/partners/types";
import { Card, CardTitle } from "@/components/admin/ui";

type Step = {
  label: string;
  variant: "lime" | "outline" | "danger";
  /** Asks first. `message`: "required" or "optional" text that is emailed to the creator. */
  ask?: { title: string; body: string; confirm: string; message?: "required" | "optional"; tone?: "danger" | "primary" };
};

const LABEL_FOR = (from: PartnerStatus, to: PartnerStatus): Step | null => {
  switch (to) {
    case "under_review":
      return { label: from === "rejected" || from === "withdrawn" ? "Reopen for review" : from === "approved" ? "Move back to review" : "Mark under review", variant: from === "submitted" ? "lime" : "outline" };
    case "more_info":
      return { label: "Request more info", variant: "outline", ask: { title: "Ask the creator for more information?", body: "The creator gets an email with your message. Internal notes are not included.", confirm: "Send request", message: "required", tone: "primary" } };
    case "approved":
      if (from === "offer_sent") return { label: "Move back to approved", variant: "outline", ask: { title: "Move back to approved?", body: "Use this when the creator declined outside the offer link. You can then send a new offer.", confirm: "Move to approved", tone: "primary" } };
      return { label: "Approve", variant: from === "submitted" ? "outline" : "lime", ask: { title: "Approve this application?", body: "The creator gets an email saying their application is approved. The next step is an offer.", confirm: "Approve", message: "optional", tone: "primary" } };
    case "rejected":
      return { label: "Reject", variant: "danger", ask: { title: "Reject this application?", body: "The creator gets an email with the reason you write below. Internal notes are not included.", confirm: "Reject application", message: "required" } };
    case "offer_sent":
      return null; // Sent from the Offers section, which creates the offer and its link.
    case "offer_accepted":
      return { label: "Mark offer accepted", variant: "outline", ask: { title: "Mark the offer as accepted?", body: "Use this only when the creator accepted outside the offer link. It is logged under your name.", confirm: "Mark accepted", tone: "primary" } };
    case "active":
      return { label: "Mark partnership active", variant: "lime", ask: { title: "Mark the partnership active?", body: "The creator gets an email that the partnership has started.", confirm: "Mark active", tone: "primary" } };
    case "completed":
      return { label: "Mark completed", variant: "outline", ask: { title: "Mark this partnership completed?", body: "The creator gets a thank-you email. This can't be reopened.", confirm: "Mark completed", tone: "primary" } };
    case "withdrawn":
      return { label: "Withdraw", variant: "danger", ask: { title: "Withdraw this application?", body: "Use this when the creator asked to stop or the partnership is cancelled. The creator gets an email.", confirm: "Withdraw application" } };
    default:
      return null;
  }
};

/** The status actions this application allows right now (PARTNER_TRANSITIONS), each logged and emailed by the server. */
export default function ActionBar({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<{ to: PartnerStatus; step: Step } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const from = status as PartnerStatus;
  const nexts = (PARTNER_TRANSITIONS[from] ?? []).map((to) => ({ to, step: LABEL_FOR(from, to) })).filter((x): x is { to: PartnerStatus; step: Step } => !!x.step);
  const canOffer = (PARTNER_TRANSITIONS[from] ?? []).includes("offer_sent");

  async function go(to: PartnerStatus, text?: string) {
    setBusy(to);
    try {
      await adminApi(`/api/admin/partners/${id}/status`, { method: "POST", json: { to, ...(text ? { message: text } : {}) } });
      toast("Status updated.");
      setOpen(null);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  function confirm() {
    if (!open) return;
    const text = message.trim();
    if (open.step.ask?.message === "required" && text.length < 3) {
      setError("Write the message the creator will read.");
      document.getElementById("pa-msg")?.focus();
      return;
    }
    void go(open.to, text || undefined);
  }

  return (
    <Card>
      <CardTitle hint="Every step is logged. Status emails go to the creator.">Actions</CardTitle>
      {nexts.length === 0 && !canOffer ? (
        <p className="text-[13.5px] text-muted-foreground">This application is closed. No further steps are available.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canOffer && (
            <Button asChild variant="lime">
              <a href="#offers">Send an offer</a>
            </Button>
          )}
          {nexts.map(({ to, step }) => (
            <Button
              key={to}
              type="button"
              variant={canOffer && step.variant === "lime" ? "outline" : step.variant}
              disabled={!!busy}
              onClick={() => {
                if (!step.ask) return void go(to);
                setMessage("");
                setError("");
                setOpen({ to, step });
              }}
            >
              {busy === to ? "Saving…" : step.label}
            </Button>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!open}
        onOpenChange={(o) => !o && !busy && setOpen(null)}
        title={open?.step.ask?.title ?? ""}
        body={open?.step.ask?.body ?? ""}
        confirmLabel={open?.step.ask?.confirm ?? "Confirm"}
        cancelLabel="Cancel"
        tone={open?.step.ask?.tone ?? "danger"}
        busy={!!busy}
        disabled={open?.step.ask?.message === "required" && message.trim().length < 3}
        size={open?.step.ask?.message ? "wide" : "default"}
        onConfirm={confirm}
        extra={
          open?.step.ask?.message ? (
            <div className="mt-3">
              <Label htmlFor="pa-msg">{open.step.ask.message === "required" ? "Message to the creator" : "Message to the creator (optional)"}</Label>
              <Textarea
                id="pa-msg"
                rows={5}
                maxLength={2000}
                value={message}
                aria-invalid={error ? true : undefined}
                aria-describedby="pa-msg-help"
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (error) setError("");
                }}
                placeholder={open.to === "rejected" ? "Thanks for applying. We're looking for creators with a stronger focus on productivity tools right now." : "Could you share your last 30 days of reach for Instagram?"}
              />
              <p id="pa-msg-help" className={error ? "mt-1.5 text-[12.5px] text-destructive" : "mt-1.5 text-[12.5px] text-muted-foreground"}>
                {error || "Sent as written. Keep internal context in the notes."}
              </p>
            </div>
          ) : undefined
        }
      />
    </Card>
  );
}
