import Link from "next/link";
import { ErrorScreen, pill } from "@/components/shared/ErrorScreen";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <ErrorScreen
      code="Lost in orbit"
      mood="think"
      title="We couldn't find that page."
      body="The link may be old, or the page moved. Your posts and media are safe; nothing was changed."
      actions={
        <>
          <Link href="/home" className={`${pill} lime-bg lime-glow`}>Go to my dashboard</Link>
          <Link href="/" className={`${pill} hairline hover:bg-secondary`}>Outlly home</Link>
        </>
      }
    />
  );
}
