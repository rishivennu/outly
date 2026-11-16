import { STEPS, type Step } from "./types";

export const stepIndex = (s: Step) => STEPS.findIndex((x) => x.id === s);

/** Pure, so it is tested apart from the screen: what each step shows. */
export function stepStates(step: Step, furthest: Step | undefined, reachable: Record<Step, boolean>, complete?: boolean) {
  const at = stepIndex(step);
  const far = Math.max(at, furthest ? stepIndex(furthest) : at);
  return STEPS.map((s, i) => {
    const state: "done" | "current" | "upcoming" | "blocked" = complete ? "done" : i === at ? "current" : i < far ? "done" : reachable[s.id] ? "upcoming" : "blocked";
    return { ...s, i, state, canGo: !complete && i !== at && reachable[s.id] };
  });
}

/** "25% done": the share of the four steps finished. */
export const donePercent = (step: Step, complete?: boolean) => (complete ? 100 : Math.round((stepIndex(step) / STEPS.length) * 100));
