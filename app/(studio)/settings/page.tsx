import { cookies } from "next/headers";
import { practiceAllowed } from "@/lib/social/registry";
import { SettingsView, type SimMode } from "@/components/settings/SettingsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const MODES: SimMode[] = ["realistic", "smooth", "instagram-reconnect", "youtube-flaky", "x-rejects"];

export default function SettingsPage() {
  const raw = cookies().get("studio_sim")?.value as SimMode | undefined;
  const sim = raw && MODES.includes(raw) ? raw : "realistic";
  return <SettingsView sim={sim} mock={practiceAllowed()} />;
}
