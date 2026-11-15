"use client";
import { useState } from "react";
import { Camera, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { ImageCropper } from "@/components/profile/ImageCropper";
import { SocialLinksSheet } from "@/components/profile/ProfileSheets";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { NICHE_MAX, type ProfileCardView } from "@/lib/profile-card-core";
import type { OnboardingProfile } from "@/lib/onboarding-core";

/**
 * Name, what you make, a picture and your links, through the same endpoints the profile card uses
 * (/api/settings/profile, its image cropper, the links sheet). Saving moves the flow on.
 */
export function ProfileStep({ profile, seed, onSaved, onChanged }: { profile: OnboardingProfile; seed: string; onSaved: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(profile.name);
  const [niche, setNiche] = useState(profile.niche ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState(false);
  const [card, setCard] = useState<ProfileCardView | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("What should we call you?");
    setBusy(true);
    setError(null);
    try {
      await api("/api/settings/profile", { method: "PATCH", json: { name: name.trim(), niche: niche.trim() || null } });
      onSaved();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : "That didn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const links = async () => {
    setLoadingLinks(true);
    try {
      setCard((await api<{ card: ProfileCardView }>("/api/profile/card")).card);
    } catch (x) {
      toast(x instanceof ApiError ? x.message : "Your links didn't load. Try again.", "error");
    } finally {
      setLoadingLinks(false);
    }
  };

  return (
    <form onSubmit={save} noValidate>
      <p className="text-[15px] leading-relaxed text-muted-foreground">This is what people see on your creator card. You can change any of it later in Settings.</p>
      <div className="mt-4 flex items-center gap-3">
        <OrbAvatar avatar={profile.avatar} seed={seed} size={56} label="Your picture" />
        <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setCrop(true)}>
          <Camera className="h-4 w-4" aria-hidden="true" /> {profile.hasPhoto ? "Change photo" : "Add a photo"}
        </Button>
      </div>
      <div className="mt-4">
        <Label htmlFor="ob-name">Name</Label>
        <Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required aria-invalid={!!error && !name.trim()} />
      </div>
      <div className="mt-3">
        <Label htmlFor="ob-niche">What you make (optional)</Label>
        <Input id="ob-niche" value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={NICHE_MAX} placeholder="Travel, food, tech reviews" aria-describedby="ob-niche-d" />
        <p id="ob-niche-d" className="mt-2 text-xs text-muted-foreground">Your niche or category. Shows as a small tag next to your name.</p>
      </div>
      <div className="mt-3">
        <Button type="button" size="sm" variant="ghost" className="min-h-11 px-3" onClick={links} disabled={loadingLinks}>
          <Link2 className="h-4 w-4" aria-hidden="true" /> {loadingLinks ? "Opening your links" : "Add your links"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="lime" className="mt-4 w-full sm:w-auto" disabled={busy}>
        {busy ? "Saving" : "Save and continue"}
      </Button>
      <ImageCropper
        kind="avatar"
        open={crop}
        onOpenChange={setCrop}
        hasCurrent={profile.hasPhoto}
        onSaved={() => {
          setCrop(false);
          onChanged();
        }}
      />
      {card && (
        <SocialLinksSheet
          open={!!card}
          onOpenChange={(o) => !o && setCard(null)}
          card={card}
          onSaved={() => {
            setCard(null);
            onChanged();
          }}
        />
      )}
    </form>
  );
}
