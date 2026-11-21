"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */
import * as React from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { SHAKE_X } from "@/lib/client/shake";
import { cn } from "@/lib/utils";

type CellProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd" | "value"> & {
  value: string;
};

/** One digit box. It pops when a digit lands in it (a new one, not a re-render). */
export const OtpCell = React.forwardRef<HTMLInputElement, CellProps>(function OtpCell({ value, className, ...props }, ref) {
  const calm = useReducedMotion();
  const pop = useAnimationControls();
  const prev = React.useRef(value);
  React.useEffect(() => {
    const was = prev.current;
    prev.current = value;
    if (calm || !value || value === was) return;
    void pop.start({ scale: [1, 1.12, 1] }, { duration: 0.26, ease: "easeOut" });
  }, [value, calm, pop]);
  return <motion.input ref={ref} value={value} animate={pop} className={cn("will-change-transform", className)} {...props} />;
});

/**
 * The row of boxes as one group. When `invalid` turns on (a wrong code came back) the row shakes once, the
 * same small shake the auth forms use. Pass shake={false} where the page already shakes the boxes itself.
 */
export function OtpGroup({ invalid, shake = true, className, children, ...props }: Omit<React.HTMLAttributes<HTMLDivElement>, "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"> & { invalid?: boolean; shake?: boolean }) {
  const calm = useReducedMotion();
  const move = useAnimationControls();
  const was = React.useRef(!!invalid);
  React.useEffect(() => {
    const before = was.current;
    was.current = !!invalid;
    if (!shake || calm || !invalid || before) return;
    void move.start({ x: [0, ...SHAKE_X] }, { duration: 0.4, ease: "easeOut" });
  }, [invalid, shake, calm, move]);
  return (
    <motion.div role="group" animate={move} className={className} {...props}>
      {children}
    </motion.div>
  );
}
