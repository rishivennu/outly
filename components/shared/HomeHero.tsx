"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D, type IconName } from "@/components/brand/Icon3D";
import { UploadZone } from "./UploadZone";
import { handoffFile } from "@/lib/client/handoff";
import { Greeting } from "./Greeting";

/** Decorative 3D icons parked in the hero's corners; they drift unless motion is reduced. */
const DECOR: { name: IconName; className: string; size: number; rot: number; delay: number }[] = [
  { name: "upload", className: "left-[3%] top-[10%]", size: 104, rot: -8, delay: 0 },
  { name: "ai-assistant", className: "right-[4%] top-[6%]", size: 112, rot: 7, delay: 1.4 },
  { name: "write-captions", className: "left-[7%] top-[46%]", size: 88, rot: 5, delay: 2.6 },
  { name: "publish", className: "right-[7%] top-[44%]", size: 96, rot: -6, delay: 3.8 },
];

export function HomeHero({ firstName }: { firstName: string }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  return (
    <section className="relative px-5 pb-16 pt-6 sm:px-10 lg:pt-14" aria-labelledby="home-title">
      <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
        {DECOR.map((d) => (
          <span key={d.name} className={`absolute ${d.className}`}>
            <span className="animate-bob block" style={{ ["--rot" as string]: `${d.rot}deg`, animationDelay: `${d.delay}s` }}>
              <Icon3D name={d.name} size={d.size} />
            </span>
          </span>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="relative mb-5 flex justify-center">
        <Greeting name={firstName} />
      </motion.div>
      <motion.h1
        id="home-title"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="display relative mx-auto max-w-[12ch] text-balance text-center text-[clamp(2.8rem,8.5vw,6.75rem)]"
      >
        What are we <span className="accent-serif energy-text">creating</span> today?
      </motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="relative mx-auto mt-6 max-w-md text-center text-lg text-muted-foreground">
        One video. Every platform. Zero chaos.
      </motion.p>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="relative mt-8 flex justify-center">
        <Button asChild variant="lime" size="lg">
          <Link href="/create">
            Create something <Sparkles className="h-5 w-5" aria-hidden="true" />
          </Link>
        </Button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.12, type: "spring", stiffness: 180, damping: 24 }} className="relative mt-10">
        <p className="mb-4 text-center text-sm text-muted-foreground">…or start from a video you already have.</p>
        <UploadZone
          accepted={accepted}
          onFile={(f) => {
            handoffFile(f);
            setAccepted(true);
            router.prefetch("/create");
            setTimeout(() => router.push("/create"), 650);
          }}
        />
      </motion.div>
    </section>
  );
}
