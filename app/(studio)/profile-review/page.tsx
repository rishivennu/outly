import { ProfileReview } from "@/components/analytics/ProfileReview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile Review" };

/**
 * 1171: the profile review in its own place (it used to be the last section of Analytics). The session is
 * checked by the middleware and the studio layout; the review itself comes from GET /api/analytics/review, the
 * live counter from /api/analytics/live, both scoped to the signed-in account on the server.
 */
export default function ProfileReviewPage() {
  return (
    <div className="page-frame pb-20 pt-6 lg:pt-10">
      <ProfileReview />
    </div>
  );
}
