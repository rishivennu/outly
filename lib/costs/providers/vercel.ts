import "server-only";
import { getJson, type Adapter } from "./types";

/**
 * Vercel. The public REST API names the team and its plan and lists projects; it has no usage or invoice endpoint
 * (usage lives in the dashboard and its CSV export). So this adapter proves the token, records the plan and project
 * list as facts, and leaves money to the estimate path (bandwidth price on file) and to invoices typed or imported.
 */
type Team = { id: string; slug: string; name: string; billing?: { plan?: string } };
type User = { user: { id: string; username: string; name?: string } };
type Projects = { projects: { id: string; name: string; framework?: string | null; updatedAt?: number }[] };

export const vercel: Adapter = {
  provider: "vercel",
  label: "Vercel",
  tokenHelp: "Account Settings > Tokens > Create, scope it to the team, expiry 1 year. Any token can only read here; nothing is written.",
  scopeLabel: "Team id",
  scopeHelp: "team_… from Team Settings > General. Leave empty for a personal (Hobby) account.",
  capability: "Checks the token, records the plan and the project list. Vercel's public API exposes no usage or invoices: bandwidth stays an estimate from the price on file; paste invoices or import them as CSV.",
  async test(token, scope) {
    if (scope) {
      const t = await getJson<Team>(`https://api.vercel.com/v2/teams/${encodeURIComponent(scope)}`, token);
      return { label: `${t.name} (${t.slug})`, facts: { plan: t.billing?.plan ?? "", slug: t.slug } };
    }
    const u = await getJson<User>("https://api.vercel.com/v2/user", token);
    return { label: u.user.name || u.user.username, facts: { plan: "hobby", slug: u.user.username } };
  },
  async sync(token, scope) {
    const t = await this.test(token, scope);
    const qs = scope ? `?teamId=${encodeURIComponent(scope)}&limit=100` : "?limit=100";
    const p = await getJson<Projects>(`https://api.vercel.com/v9/projects${qs}`, token);
    return { booked: 0, facts: { ...t.facts, projects: p.projects.map((x) => x.name).sort(), projectCount: p.projects.length }, notes: ["Vercel's public API has no usage or invoice endpoint; nothing was booked. Plan and projects recorded."] };
  },
};
