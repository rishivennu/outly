import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Real marks for the services Outlly plugs into (1055), drawn as small app tiles in each brand's own colours.
 * Glyphs are the official single-colour marks (Simple Icons, CC0), inlined so the admin never waits on a CDN.
 */
const MARK = {
  stripe: { bg: "#635BFF", fg: "#ffffff", d: "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z" },
  razorpay: { bg: "#072654", fg: "#3395FF", d: "M22.436 0l-11.91 7.773-1.174 4.276 6.625-4.297L11.65 24h4.391l6.395-24zM14.26 10.098L3.389 17.166 1.564 24h9.008l3.688-13.902Z" },
  paypal: { bg: "#ffffff", fg: "#003087", d: "M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z" },
  resend: { bg: "#000000", fg: "#ffffff", d: "M14.679 0c4.648 0 7.413 2.765 7.413 6.434s-2.765 6.434-7.413 6.434H12.33L24 24h-8.245l-8.88-8.44c-.636-.588-.93-1.273-.93-1.86 0-.831.587-1.565 1.713-1.883l4.574-1.224c1.737-.465 2.936-1.81 2.936-3.572 0-2.153-1.761-3.4-3.939-3.4H0V0z" },
  whatsapp: { bg: "#25D366", fg: "#ffffff", d: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" },
} as const;

export type Service = keyof typeof MARK | "upi" | "mock";

/** A brand tile. Decorative: the option or heading next to it already says the name. */
export function ServiceLogo({ service, size = 36, className }: { service: Service; size?: number; className?: string }) {
  const box = cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-[28%] shadow-[0_0_0_1px_hsl(var(--foreground)/.12)]", className);
  if (service === "mock")
    return (
      <span className={cn(box, "bg-secondary text-muted-foreground")} style={{ width: size, height: size }} aria-hidden="true">
        <FlaskConical style={{ width: size * 0.5, height: size * 0.5 }} />
      </span>
    );
  if (service === "upi")
    return (
      <span className={box} style={{ width: size, height: size, background: "#fff" }} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/pay/upi.png" alt="" style={{ height: size * 0.36, width: "auto" }} />
      </span>
    );
  const m = MARK[service];
  return (
    <span className={box} style={{ width: size, height: size, background: m.bg }} aria-hidden="true">
      <svg viewBox="0 0 24 24" style={{ width: size * 0.56, height: size * 0.56 }} fill={m.fg}>
        <path d={m.d} />
      </svg>
    </span>
  );
}
