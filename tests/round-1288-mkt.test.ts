// R1288 MKT: EasyUI ports (Stepper, MorphingButton, OtpInput, UndoToast, FAQ, ExpandableSearch) wired into auth, toasts, FAQ and help search.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const PORTS = ["Stepper", "MorphingButton", "OtpInput", "UndoToast", "FAQ", "ExpandableSearch"].map((n) => `components/ui/easy/${n}.tsx`);

describe("R1288 ports", () => {
  test("each port carries the MIT credit, is a client file, and keeps reduced motion", () => {
    for (const f of PORTS) {
      const s = read(f);
      expect(s.startsWith('"use client";\n/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.')).toBe(true);
      expect(s).toContain("useReducedMotion");
    }
  });
  test("ports use Outlly tokens: no dark: classes, no neutral palette, no hex literals, no em-dashes", () => {
    for (const f of PORTS) {
      const s = read(f);
      expect(s, f).not.toMatch(/\bdark:/);
      expect(s, f).not.toMatch(/(text|bg|border)-(neutral|gray)-\d|bg-white\b|bg-black\b|#[0-9A-Fa-f]{6}\b/);
      expect(s, f).not.toContain("\u2014");
      expect(s, f).not.toContain("../../lib/");
    }
  });
});

describe("R1288 Stepper (standalone; the partners form is redesigned in a later round)", () => {
  const easy = read("components/ui/easy/Stepper.tsx");
  test("label + optional hint steps, gliding ring, drawn check, filling lines, 44px jump-back targets", () => {
    expect(easy).toContain("export interface Step {\n  label: string;\n  hint?: string;\n}");
    expect(easy).toContain('layoutId={`${uid}-ring`}');
    expect(easy).toContain('d="M5 12.5l4.5 4.5L19 7.5"');
    expect(easy).toContain("{ scaleX: i < current ? 1 : 0 }");
    expect(easy).toContain('aria-current={state === "current" ? "step" : undefined}');
    expect(easy).toContain("min-h-11 min-w-11");
  });
  test("StepPanels slides in by direction, enter only, so a new step's fields are in the DOM at once", () => {
    expect(easy).toContain("export function StepPanels(");
    expect(easy).toContain("const dir = current >= prev.current ? 1 : -1;");
    expect(easy).toContain("const list = Array.isArray(children) ? children : [children];");
    expect(easy).not.toContain("AnimatePresence");
  });
  test("R1289: the redesigned partners form uses the ported Stepper and StepPanels (its own form/Stepper.tsx is gone)", () => {
    expect(read("components/partners/ApplyForm.tsx")).toContain('import { Stepper, StepPanels } from "@/components/ui/easy/Stepper";');
    expect(existsSync("components/partners/form/Stepper.tsx")).toBe(false);
  });
});

describe("R1288 MorphingButton", () => {
  const m = read("components/ui/easy/MorphingButton.tsx");
  test("built on the shared Button, width held by invisible faces, loading disables", () => {
    expect(m).toContain('import { Button, type ButtonProps } from "@/components/ui/button";');
    expect(m).toContain('{(["idle", "loading", "success"] as const).map((s) => (');
    expect(m).toContain('className="invisible flex items-center gap-2 [grid-area:1/1]"');
    expect(m).toContain("disabled={disabled || busy} aria-busy={busy || undefined}");
    expect(m).toContain('<span className="min-w-0 truncate">{errorText}</span>');
  });
});

describe("R1288 auth", () => {
  const auth = read("components/auth/AuthForm.tsx");
  test("the sign in / sign up button morphs, keeping its copy, handler and disabled logic", () => {
    expect(auth).toContain('import { MorphingButton } from "@/components/ui/easy/MorphingButton";');
    expect(auth).toContain('className="auth-cta h-12 w-full text-[15px]"\n            disabled={busy}');
    expect(auth).toContain('status={signedIn ? "success" : busy ? "loading" : ctaErr && error ? "error" : "idle"}');
    expect(auth).toContain("errorText={error}");
    expect(auth).toContain('{!busy && <ArrowRight className="auth-cta-arrow h-[18px] w-[18px]" aria-hidden="true" />}');
    expect(auth).toContain("const go = () => {\n    setSignedIn(true);");
    expect(auth).not.toContain('from "@/components/ui/button"');
  });
  test("the code boxes pop per digit and shake on a wrong code; AuthForm keeps its own shake", () => {
    const boxes = read("components/auth/OtpBoxes.tsx");
    expect(boxes).toContain('import { OtpCell, OtpGroup } from "@/components/ui/easy/OtpInput";');
    expect(boxes).toContain("<OtpGroup invalid={invalid} shake={shake} aria-label={label} aria-describedby={describedBy}");
    expect(boxes).toContain("<OtpCell");
    expect(boxes).toContain('autoComplete={i === 0 ? "one-time-code" : "off"}');
    expect(boxes).toContain('inputMode="numeric"');
    expect(auth).toContain("invalid={!!error}\n                shake={false}");
    const otp = read("components/ui/easy/OtpInput.tsx");
    expect(otp).toContain("scale: [1, 1.12, 1]");
    expect(otp).toContain("x: [0, ...SHAKE_X]");
    expect(otp).toContain("if (!shake || calm || !invalid || before) return;");
  });
});

describe("R1288 undo toast", () => {
  const toast = read("components/shared/Toast.tsx");
  test("only Undo actions get the ring", async () => {
    const { isUndoAction, restoredHoldMs, RESTORED_TEXT } = await import("@/components/ui/easy/UndoToast");
    expect(isUndoAction({ label: "Undo" })).toBe(true);
    expect(isUndoAction({ label: "Retry" })).toBe(false);
    expect(isUndoAction(undefined)).toBe(false);
    expect(restoredHoldMs(true)).toBeLessThan(restoredHoldMs(false));
    expect(RESTORED_TEXT).toBe("Restored.");
    const { UNDO_MS } = await import("@/components/shared/useUndoDelete");
    expect(UNDO_MS).toBe(6000);
  });
  test("the toast renders the ring off its own clock, runs Undo at once, and closes as an action", () => {
    expect(toast).toContain('import { RESTORED_TEXT, UndoRing, isUndoAction, restoredHoldMs } from "@/components/ui/easy/UndoToast";');
    expect(toast).toContain("{undo && total !== null ? <UndoRing total={total} left={left} restored={restored} /> :");
    expect(toast).toContain("const left = useCallback(() => timer.current?.left() ?? total ?? 0, [total]);");
    expect(toast).toContain("timer.current?.cancel();\n    setRestored(true);\n    onAct();");
    expect(toast).toContain('onClick={undo ? pressUndo : () => onClose("action")}');
    expect(toast).toContain('const why = t.acted ? "action" : reason;');
    expect(toast).toContain('if (why === "action" && !t.acted) t.action?.onClick();');
    // the outlly:toast bridge and the hover/focus hold are unchanged
    expect(toast).toContain("window.addEventListener(TOAST_EVENT, on);");
    expect(toast).toContain('onPointerEnter={() => hold("hover", true)}');
  });
});

describe("R1288 FAQ and help search", () => {
  test("home FAQ and the help centre list render the EasyUI FAQ, single open, deep-link ids kept", () => {
    const faq = read("components/marketing/Faq.tsx");
    expect(faq).toContain('import { FAQ } from "@/components/ui/easy/FAQ";');
    expect(faq).toContain('<FAQ reveal items={FAQS.map((f, i) => ({ id: `m${i}`, question: f.q, answer: f.a }))} defaultOpen={["m0"]} />');
    expect(faq).not.toContain("\"use client\"");
    const hc = read("components/support/HelpCenter.tsx");
    expect(hc).toContain('<FAQ key={`${cat}|${openId}`} defaultOpen={openId ? [openId] : []}');
    expect(hc).not.toContain("LiquidAccordion");
    const easy = read("components/ui/easy/FAQ.tsx");
    expect(easy).toContain("allowMultiple ? [...o, id] : [id]");
    expect(easy).toContain('id={`faq-${item.id}`}');
    expect(easy).toContain('animate={{ height: on ? "auto" : 0, opacity: on ? 1 : 0 }}');
    expect(easy).toContain("inert={!on}");
    expect(read("app/(marketing)/page.tsx")).toContain('"@type": "FAQPage"');
  });
  test("the help search is the expandable pill with the / shortcut and a 44px clear, keeping its combobox", () => {
    const hc = read("components/support/HelpCenter.tsx");
    expect(hc).toContain('import { ExpandableSearch } from "@/components/ui/easy/ExpandableSearch";');
    expect(hc).toContain('<ExpandableSearch\n        ref={inputRef}\n        className="mt-8"\n        onClear={() => setQ("")}\n        id="help-q"');
    expect(hc).toContain('role="combobox"');
    expect(hc).toContain('<ul id="help-sug" role="listbox"');
    const es = read("components/ui/easy/ExpandableSearch.tsx");
    expect(es).toContain('shortcut = "/"');
    expect(es).toContain("animate={{ maxWidth: wide ? expandedWidth : compactWidth }}");
    expect(es).toContain('aria-label="Clear search"');
    expect(es).toContain("grid h-11 w-11");
    expect(es).toContain("typing(e.target)) return;");
  });
});
