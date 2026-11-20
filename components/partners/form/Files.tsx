"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import { PARTNER_FILE_MAX_BYTES, PARTNER_FILE_MAX_COUNT, PARTNER_FILE_TYPES } from "@/lib/partners/types";
import { ERROR_INK } from "./Field";
import type { UploadedFile } from "./draft";

type Pending = { id: string; name: string; size: number; progress: number; error?: string };

/** Multipart upload with real progress (fetch has none). Resolves with the server's file token. */
function upload(file: File, onProgress: (p: number) => void): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/partners/files");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { error?: string } & Partial<UploadedFile> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.token) resolve(data as UploadedFile);
      else reject(new Error(data.error ?? "That upload didn't finish. Try again."));
    };
    xhr.onerror = () => reject(new Error("The connection dropped. Check it and try again."));
    const body = new FormData();
    body.append("file", file);
    xhr.send(body);
  });
}

const allowed = (f: File) => (PARTNER_FILE_TYPES as readonly string[]).includes(f.type) || /\.(png|jpe?g|pdf)$/i.test(f.name);

export function Files({ files, onChange, onBusy }: { files: UploadedFile[]; onChange: (next: (prev: UploadedFile[]) => UploadedFile[]) => void; onBusy: (n: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [note, setNote] = useState("");
  const [over, setOver] = useState(false);
  const active = pending.filter((p) => !p.error).length;
  const room = PARTNER_FILE_MAX_COUNT - files.length - active;
  useEffect(() => onBusy(active), [active, onBusy]);

  const add = (list: FileList | File[]) => {
    const picked = Array.from(list);
    const msgs: string[] = [];
    const take = picked.slice(0, Math.max(0, room));
    if (picked.length > take.length) msgs.push(`You can attach up to ${PARTNER_FILE_MAX_COUNT} files.`);
    const jobs: { p: Pending; f: File }[] = [];
    for (const f of take) {
      if (!allowed(f)) msgs.push(`${f.name} is not a PNG, JPG or PDF.`);
      else if (f.size > PARTNER_FILE_MAX_BYTES) msgs.push(`${f.name} is over 8 MB.`);
      else jobs.push({ f, p: { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: f.name, size: f.size, progress: 0 } });
    }
    setNote(msgs.join(" "));
    if (!jobs.length) return;
    setPending((p) => [...p, ...jobs.map((j) => j.p)]);
    for (const { f, p } of jobs) {
      upload(f, (progress) => setPending((all) => all.map((x) => (x.id === p.id ? { ...x, progress } : x))))
        .then((done) => {
          setPending((all) => all.filter((x) => x.id !== p.id));
          onChange((prev) => [...prev, done].slice(0, PARTNER_FILE_MAX_COUNT));
        })
        .catch((e: Error) => setPending((all) => all.map((x) => (x.id === p.id ? { ...x, error: e.message } : x))));
    }
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) add(e.dataTransfer.files);
        }}
        className={cn("flex flex-col items-center gap-3 rounded-2xl border border-dashed border-foreground/[0.08] bg-secondary/30 px-5 py-7 text-center transition-colors", over && "bg-secondary")}
      >
        <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-[14px] text-muted-foreground">Drop analytics screenshots or PDFs here, or</p>
        <Button type="button" variant="outline" className="h-11" onClick={() => input.current?.click()} disabled={room <= 0} aria-describedby="pa-files-help">
          Choose files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
        <p id="pa-files-help" className="text-[12px] text-muted-foreground">
          PNG, JPG or PDF, up to 8 MB each, {PARTNER_FILE_MAX_COUNT} files at most.
        </p>
      </div>
      <p className={cn("text-[13px]", ERROR_INK, note && "mt-2")} aria-live="polite">
        {note}
      </p>
      {(files.length > 0 || pending.length > 0) && (
        <ul className="mt-3 grid gap-2" aria-label="Attached files">
          {files.map((f) => (
            <li key={f.token} className="flex min-h-12 items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2">
              {f.mime === "application/pdf" ? <FileText className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" /> : <ImageIcon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate text-[14px]" title={f.name}>
                {f.name}
              </span>
              <span className="tabular-nums text-[12px] text-muted-foreground">{formatBytes(f.size)}</span>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${f.name}`} onClick={() => onChange((prev) => prev.filter((x) => x.token !== f.token))}>
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.id} className="flex min-h-12 flex-wrap items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[14px]" title={p.name}>
                {p.name}
              </span>
              {p.error ? (
                <>
                  <span className={cn("text-[12px]", ERROR_INK)}>{p.error}</span>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Dismiss ${p.name}`} onClick={() => setPending((all) => all.filter((x) => x.id !== p.id))}>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </>
              ) : (
                <span className="flex w-28 items-center gap-2">
                  <span
                    role="progressbar"
                    aria-label={`Uploading ${p.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(p.progress * 100)}
                    className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]"
                  >
                    <span className="absolute inset-y-0 start-0 rounded-full bg-lime-ink transition-[width]" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                  </span>
                  <span className="tabular-nums text-[12px] text-muted-foreground">{Math.round(p.progress * 100)}%</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
