"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Info } from "lucide-react";

type T = { id: number; text: string; tone: "ok" | "info" | "error" };
const Ctx = createContext<(text: string, tone?: T["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((text: string, tone: T["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-24 z-[90] flex flex-col items-center gap-2 px-4 lg:bottom-8">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} className="glass-strong pointer-events-auto flex max-w-[min(520px,calc(100vw-2rem))] items-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-medium">
              {t.tone === "ok" ? <Check className="h-4 w-4 shrink-0 text-success" aria-hidden /> : t.tone === "error" ? <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden /> : <Info className="h-4 w-4 shrink-0 text-accent" aria-hidden />}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
