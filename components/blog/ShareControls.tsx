"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";

const btn = "inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-[14px] font-medium hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const link = `${btn} underline decoration-border underline-offset-4`;

export function ShareControls({ url, title }: { url: string; title: string }) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    return () => clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 2500);
  };
  const share = async () => {
    try {
      await navigator.share({ title, url });
    } catch {
      /* the reader closed the sheet */
    }
  };
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);

  return (
    <div role="group" aria-labelledby="share-title" className="flex flex-wrap items-center gap-2">
      <span id="share-title" className="mr-1 text-[14px] font-semibold">
        Share this article
      </span>
      {canShare && (
        <button type="button" onClick={share} className={btn}>
          <Share2 aria-hidden="true" className="h-4 w-4" />
          Share
        </button>
      )}
      <button type="button" onClick={copy} className={btn}>
        {copied === "ok" ? <Check aria-hidden="true" className="h-4 w-4" /> : <Link2 aria-hidden="true" className="h-4 w-4" />}
        {copied === "ok" ? "Link copied" : "Copy link"}
      </button>
      <a href={`https://twitter.com/intent/tweet?url=${u}&text=${t}`} target="_blank" rel="noopener noreferrer" className={link}>
        X<span className="sr-only"> (opens in a new tab)</span>
      </a>
      <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${u}`} target="_blank" rel="noopener noreferrer" className={link}>
        LinkedIn<span className="sr-only"> (opens in a new tab)</span>
      </a>
      <a href={`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`} target="_blank" rel="noopener noreferrer" className={link}>
        WhatsApp<span className="sr-only"> (opens in a new tab)</span>
      </a>
      <span role="status" aria-live="polite" className="sr-only">
        {copied === "ok" ? "Link copied to the clipboard" : copied === "fail" ? "Could not copy. Copy the address from the browser bar." : ""}
      </span>
      {copied === "fail" && <span className="text-[13px] text-muted-foreground">Could not copy. Copy the address from the browser bar.</span>}
    </div>
  );
}
