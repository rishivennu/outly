"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/admin/ui";

/**
 * 1163: when an admin page throws (a query times out, an integration is down) the sidebar stays and the content
 * area says so. Nothing is estimated in its place. `reset` re-renders the route; the message carries the error's
 * digest so it can be found in the logs.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[admin]", error);
  }, [error]);
  return (
    <div className="mx-auto mt-10 max-w-xl">
      <ErrorState
        title="This page couldn't load"
        body={`${error.message || "Something went wrong on our side."}${error.digest ? ` Reference ${error.digest}.` : ""} Nothing was changed; the numbers that would have appeared here are not shown rather than guessed.`}
        retry={
          <Button type="button" variant="lime" onClick={reset}>
            Try again
          </Button>
        }
      >
        <Button asChild variant="ghost">
          <a href="/admin">Back to overview</a>
        </Button>
      </ErrorState>
    </div>
  );
}
