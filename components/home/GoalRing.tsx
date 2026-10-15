"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Flame, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import type { GoalState } from "@/lib/retention/core";

const CHOICES = [0, 1, 2, 3, 4, 5, 7, 10, 14];

/** Weekly posting goal as a ring, with the streak beside it. The owner can change the goal in place. */
export function GoalRing({ goal, scheduled, canEdit }: { goal: GoalState; scheduled: number; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(goal.goal);
  const [saving, setSaving] = useState(false);
  const r = 44;
  const c = 2 * Math.PI * r;
  const label = goal.goal ? `${goal.done} of ${goal.goal} posts this week` : `${goal.done} post${goal.done === 1 ? "" : "s"} this week, no goal set`;

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
    <section id="goal" aria-labelledby={`${id}-h`} className="glass flex min-w-0 scroll-mt-24 flex-col rounded-[32px] p-5 sm:p-6">
      <h2 id={`${id}-h`} className="eyebrow mb-4">This week</h2>
      <div className="flex items-center gap-5">
        <svg viewBox="0 0 100 100" className="h-[104px] w-[104px] shrink-0 -rotate-90" role="img" aria-label={label}>
          <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" className="stroke-foreground/10" />
          {goal.goal > 0 && (
            <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" strokeLinecap="round" className="goal-arc stroke-lime" strokeDasharray={c} strokeDashoffset={c * (1 - goal.progress)} />
          )}
          <text x="50" y="50" dy="0.35em" textAnchor="middle" className="rotate-90 fill-foreground text-[26px] font-semibold" style={{ transformOrigin: "50px 50px" }}>
            {goal.goal ? `${goal.done}/${goal.goal}` : goal.done}
          </text>
        </svg>
        <div className="min-w-0 text-sm">
          <p className="text-base font-semibold leading-snug">
            {!goal.goal ? "No weekly goal" : goal.met ? "Goal hit. Nice." : `${goal.left} to go`}
          </p>
          <p className="mt-1 text-muted-foreground">
            {goal.goal && !goal.met ? `${goal.daysLeft <= 1 ? "Last day" : `${goal.daysLeft} days left`}${scheduled ? `, ${scheduled} scheduled` : ""}.` : goal.goal ? "Anything extra is a bonus." : "A goal keeps a streak going."}
          </p>
          {goal.streak > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-lime/20 px-2.5 py-1 font-medium text-lime-ink">
              <Flame className="h-4 w-4" aria-hidden="true" /> {goal.streak} week streak
            </p>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="mt-4">
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
