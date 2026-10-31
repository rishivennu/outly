"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ErrorScreen, ghostPill, pill } from "@/components/shared/ErrorScreen";
import { isChunkError, reloadOnce } from "@/lib/client/chunk-reload";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    // 1079: an old build's chunk is gone after a deploy; one reload picks up the new build.
    if (isChunkError(error)) reloadOnce();
  }, [error]);
  // Read after mount: the server has no navigator, and a render-time read would mismatch on hydration.
  const [offline, setOffline] = useState(false);
  useEffect(() => setOffline(!navigator.onLine), []);
  return (
    <ErrorScreen
      code={error.digest ? `Ref ${error.digest}` : undefined}
      title={offline ? "You're offline." : "That didn't load."}
      body={offline ? "Reconnect and try again. Pages you opened recently, like Billing, still work offline." : "Something went wrong on our side, not yours. Trying again usually fixes it; if not, tell Pip the reference above."}
      actions={
        <>
          <button onClick={reset} className={`${pill} lime-bg lime-glow`}>Try again</button>
          <Link href="/home" className={ghostPill}>Back to dashboard</Link>
        </>
      }
    />
  );
}
