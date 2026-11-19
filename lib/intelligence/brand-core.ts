// R1235: the brand profile form rules, pure (zod + the objective table only) so the API route and the tests share them.
import { z } from "zod";
import { OBJECTIVES, OBJECTIVE_METRICS, type Objective } from "./core";

export const BRAND_LIMITS = { name: 60, audience: 300, tone: 120, listItems: 12, listItem: 40 } as const;

const OBJECTIVE_LABEL: Record<Objective, string> = {
  awareness: "Awareness",
  engagement: "Engagement",
  community: "Community",
  traffic: "Traffic",
  leads: "Leads",
  sales: "Sales",
};

export interface ObjectiveOption {
  id: Objective;
  label: string;
  reason: string;
  proxy: boolean;
}

export function objectiveOptions(): ObjectiveOption[] {
  return OBJECTIVES.map((id) => ({ id, label: OBJECTIVE_LABEL[id], reason: OBJECTIVE_METRICS[id].reason, proxy: OBJECTIVE_METRICS[id].proxy }));
}

const optionalText = (max: number, what: string) => z.string().trim().max(max, `${what} can be at most ${max} characters.`).nullable().optional();
const chipList = (what: string) =>
  z
    .array(z.string().trim().min(1, `${what} can't be empty.`).max(BRAND_LIMITS.listItem, `Each of ${what.toLowerCase()} can be at most ${BRAND_LIMITS.listItem} characters.`))
    .max(BRAND_LIMITS.listItems, `${what}: at most ${BRAND_LIMITS.listItems}.`)
    .optional();

export const brandProfileSchema = z.object({
  objective: z.enum(OBJECTIVES as unknown as [Objective, ...Objective[]], { message: "Choose an objective: awareness, engagement, community, traffic, leads or sales." }),
  name: optionalText(BRAND_LIMITS.name, "The brand name"),
  audience: optionalText(BRAND_LIMITS.audience, "The audience"),
  tone: optionalText(BRAND_LIMITS.tone, "The tone"),
  pillars: chipList("Content pillars"),
  avoid: chipList("Things to avoid"),
});
export type BrandProfileBody = z.infer<typeof brandProfileSchema>;
