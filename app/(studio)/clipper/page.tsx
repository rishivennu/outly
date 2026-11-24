import { getCurrentUser } from "@/lib/auth";
import { listJobs } from "@/lib/clipper/jobs";
import { ClipperStudio } from "@/components/clipper/ClipperStudio";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: "Clipper" };
}

/**
 * R1322: the AI Shorts Clipper. The job list comes with the first paint; the executor (this tab) does the work and
 * reports through /api/clipper. `?job=<id>` opens one job.
 */
export default async function ClipperPage(props: { searchParams: Promise<{ job?: string }> }) {
  const search = await props.searchParams;
  const user = (await getCurrentUser())!;
  const jobs = await listJobs(user.id, { limit: 20 }).catch(() => []);
  const openId = typeof search.job === "string" && search.job.length <= 64 ? search.job : null;
  return (
    <div className="space-y-5">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Clipper</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Long video in, ranked 9:16 clips out, each with a reason. You approve, trim and export; posting goes through Create.</p>
      </header>
      <ClipperStudio initialJobs={jobs} openId={openId} />
    </div>
  );
}
