"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import type { GoalState } from "@/lib/retention/core";
import { cn } from "@/lib/utils";
import { StreakFlame } from "./StreakFlame";
import { TIER_NAME, streakTier } from "./streak-tier";

const CHOICES = [0, 1, 2, 3, 4, 5, 7, 10, 14];

/**
 * "This week" (10-15 redesign): Pip in the streak flame up top, the streak in big numbers beside it,
 * then the weekly goal as one segment per post. The owner can change the goal in place.
 */
export function GoalRing({ goal, scheduled, canEdit }: { goal: GoalState; scheduled: number; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(goal.goal);
  const [saving, setSaving] = useState(false);
  const tier = streakTier(goal.streak);
  const label = goal.goal ? `${goal.done} of ${goal.goal} posts this week` : `${goal.done} post${goal.done === 1 ? "" : "s"} this week, no goal set`;
  const status = !goal.goal
    ? "No weekly goal yet. A goal is what keeps a streak going."
    : goal.met
      ? "Goal hit this week. Anything extra is a bonus."
      : `${goal.left} to go, ${goal.daysLeft <= 1 ? "last day" : `${goal.daysLeft} days left`}${scheduled ? `, ${scheduled} scheduled` : ""}.`;
  const segs = Math.min(goal.goal, 14);

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings/profile", { method: "PATCH", json: { postingGoal: value } });
      toast(value ? `Goal set: ${value} a week` : "Weekly goal turned off", "ok");
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't save the goal", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="goal" aria-labelledby={`${id}-h`} className="glass flex h-full min-w-0 scroll-mt-24 flex-col rounded-[32px] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-h`} className="eyebrow">This week</h2>
        <span className={cn("rounded-full px-2.5 py-1 text-[12px] font-semibold", tier ? "bg-[#ff7a1a]/15 text-[#a63d00] dark:text-[#ffb27a]" : "bg-secondary text-muted-foreground")}>{TIER_NAME[tier]}</span>
      </div>

      <div className="mt-5 flex items-center gap-4 sm:gap-5">
        <StreakFlame streak={goal.streak} met={goal.met} className="w-[clamp(112px,34vw,148px)] shrink-0" />
        <div className="min-w-0">
          <p className="tabular font-display text-[clamp(2.75rem,8vw,3.5rem)] font-semibold leading-none tracking-tight">{goal.streak}</p>
          <p className="mt-1 text-[15px] font-semibold">week streak</p>
          <p className="mt-2 text-sm text-muted-foreground">{goal.streak > 0 ? `Weeks in a row you hit your goal.` : "Hit your goal this week to light it."}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px] font-semibold tabular">{goal.goal ? `${goal.done}/${goal.goal} posts` : `${goal.done} post${goal.done === 1 ? "" : "s"}`}</p>
          {goal.met && <p className="text-[13px] font-medium text-lime-ink">Done</p>}
        </div>
        {segs > 0 && (
          <div className="mt-2 flex gap-1.5" role="img" aria-label={label}>
            {Array.from({ length: segs }, (_, i) => (
              <span key={i} className={cn("h-2.5 flex-1 rounded-full transition-colors duration-500", i < goal.done ? "bg-[#ff7a1a]" : "bg-foreground/10")} />
            ))}
          </div>
        )}
        <p className="mt-2 text-sm text-muted-foreground">{status}</p>
      </div>

      {canEdit && (
        <div className="mt-auto pt-4">
          {editing ? (
            <div className="flex flex-wrap items-end gap-2">
              <label htmlFor={`${id}-sel`} className="sr-only">Posts per week</label>
              <select id={`${id}-sel`} value={value} onChange={(e) => setValue(Number(e.target.value))} className="h-11 rounded-2xl bg-secondary px-3 text-sm hairline">
                {CHOICES.map((n) => (
                  <option key={n} value={n}>{n === 0 ? "No goal" : `${n} a week`}</option>
                ))}
              </select>
              <Button variant="lime" onClick={save} disabled={saving}>{saving ? "Saving" : "Save"}</Button>
              <Button variant="ghost" onClick={() => { setValue(goal.goal); setEditing(false); }}>Cancel</Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setEditing(true)} className="-ml-3">
              <Pencil className="h-4 w-4" aria-hidden="true" /> {goal.goal ? "Change goal" : "Set a goal"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
