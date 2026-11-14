"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Card, CardTitle } from "@/components/admin/ui";
import { useToast } from "@/components/shared/Toast";
import { econApi, errorsOf, type EconState, type FieldError } from "./api";
import { EconomicsReport } from "./EconomicsReport";

const group = (path: string) => path.split(".")[0];

export function EconomicsPanel() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <EconomicsReport />
      <RateEditor />
    </div>
  );
}

function RateEditor() {
  const toast = useToast();
  const [s, setS] = useState<EconState | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const adopt = (st: EconState) => {
    setS(st);
    setErrors(st.errors);
    setText(Object.fromEntries(st.fields.map((f) => [f.path, String(f.value)])));
  };
  useEffect(() => {
    econApi.load().then(adopt).catch((e: Error) => toast(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const groups = useMemo(() => {
    const m = new Map<string, EconState["fields"]>();
    for (const f of s?.fields ?? []) m.set(group(f.path), [...(m.get(group(f.path)) ?? []), f]);
    return [...m.entries()];
  }, [s]);
  if (!s) return <Card><p className="text-[13.5px] text-muted-foreground" role="status">Loading cost rates</p></Card>;

  const bad = Object.entries(text).filter(([, v]) => !v.trim() || !Number.isFinite(Number(v)) || Number(v) < 0).map(([k]) => k);
  const changed = s.fields.filter((f) => Number(text[f.path]) !== f.value);

  async function save() {
    setBusy(true);
    try {
      adopt(await econApi.save(Object.fromEntries(changed.map((f) => [f.path, Number(text[f.path])]))));
      toast("Cost rates saved. Floors, margins and budgets use them from the next request.");
    } catch (e) {
      const errs = errorsOf(e);
      if (errs.length) setErrors(errs);
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle hint="Seeded from the unit economics workbook. These feed the 60% floors, the margin check and every subscriber's monthly cost budget. Saving is refused if it would push a live price below its floor.">Cost rates</CardTitle>
      <div className="grid gap-5">
        {groups.map(([g, fields]) => (
          <fieldset key={g} className="min-w-0">
            <legend className="mb-2 text-[13px] font-semibold capitalize">{g.replace(/([A-Z])/g, " $1").toLowerCase()}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map((f) => {
                const id = `econ-${f.path.replace(/[^\w-]/g, "-")}`;
                const err = errors.find((e) => e.field === f.path)?.message ?? (bad.includes(f.path) ? "Enter a number, 0 or more" : undefined);
                return (
                  <div key={f.path} className="min-w-0">
                    <Label htmlFor={id} className="break-words">{f.label}</Label>
                    <Input id={id} inputMode="decimal" value={text[f.path] ?? ""} onChange={(e) => setText((t) => ({ ...t, [f.path]: e.target.value }))} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} className="tabular" />
                    {err && <p id={`${id}-err`} className="mt-1 text-[12px] text-foreground">{err}</p>}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" variant="lime" className="rounded-full" disabled={busy || !changed.length || bad.length > 0} onClick={save}>Save cost rates</Button>
        {changed.length > 0 && <Button type="button" variant="ghost" className="rounded-full" disabled={busy} onClick={() => adopt(s)}>Discard edits</Button>}
        <span className="text-[12.5px] text-muted-foreground" aria-live="polite">{changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "Saved"}</span>
      </div>
    </Card>
  );
}
