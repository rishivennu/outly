"use client";
import { useEffect } from "react";
import Link from "next/link";
import { ErrorScreen, pill } from "@/components/shared/ErrorScreen";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <ErrorScreen
      code={error.digest ? `Ref ${error.digest}` : undefined}
      title={offline ? "You're offline." : "That didn't load."}
      body={offline ? "Reconnect and try again. Pages you opened recently, like Billing, still work offline." : "Something went wrong on our side, not yours. Trying again usually fixes it; if not, tell Pip the reference above."}
      actions={
        <>
          <button onClick={reset} className={`${pill} lime-bg lime-glow`}>Try again</button>
          <Link href="/home" className={`${pill} hairline hover:bg-secondary`}>Back to dashboard</Link>
        </>
      }
    />
  );
}
