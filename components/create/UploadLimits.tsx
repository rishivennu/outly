"use client";
import { useEffect, useState } from "react";
import { AlertCircle, FileVideo } from "lucide-react";
import { Skeleton } from "@/components/shared/Skeleton";
import { limitsLine, loadUploadLimits, type UploadLimits as Limits } from "@/lib/client/upload";
import { cn } from "@/lib/utils";

/**
 * What this account can upload, read from the server (GET /api/media/direct) before a file is picked,
 * and the reason a picked file was turned away. The request is shared with the upload that follows.
 */
export function UploadLimits({ error, className }: { error?: string | null; className?: string }) {
  const [lim, setLim] = useState<Limits | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadUploadLimits().then(
      (l) => alive && setLim(l),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={cn("flex w-full max-w-md flex-col items-center gap-2 text-center", className)}>
      {lim ? (
        <p className="inline-flex items-start gap-2 text-[13px] leading-snug text-muted-foreground" data-testid="upload-limits">
          <FileVideo className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="tabular-nums">{limitsLine(lim)}</span>
        </p>
      ) : failed ? (
        <p className="text-[13px] text-muted-foreground">MP4 or MOV. We check the size when the upload starts.</p>
      ) : (
        <Skeleton className="h-5 w-64 max-w-full rounded-full" />
      )}
      {error && (
        <p role="alert" className="inline-flex items-start gap-2 text-left text-sm leading-snug text-[hsl(0_72%_42%)] dark:text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
