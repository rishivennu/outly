import { getConfig } from "@/lib/settings";
import { BlogCtaCard } from "./BlogCtaCard";

/** The one place an article mentions the product. Follows Waitlist Mode like the site's other CTAs (middleware would bounce /signup anyway). */
export async function BlogCta() {
  const waitlist = await getConfig("site")
    .then((s) => s.waitlist)
    .catch(() => false);
  return <BlogCtaCard waitlist={waitlist} />;
}
