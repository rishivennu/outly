/**
 * The platform icons around the waitlist globe (1061), and the tilted orbits they ride. Radii are in globe
 * radii; `period` is ms per lap. The phone (CSS) globe shows only the first three.
 */
export type OrbitBrand = "instagram" | "youtube" | "facebook" | "linkedin" | "x";
export type Orbiter = { brand: OrbitBrand; label: string; r: number; incl: number; node: number; phase: number; period: number };

export const ORBIT: Orbiter[] = [
  { brand: "instagram", label: "Instagram", r: 1.3, incl: 0.34, node: -0.36, phase: 0.6, period: 28_000 },
  { brand: "youtube", label: "YouTube", r: 1.3, incl: 0.34, node: -0.36, phase: 3.75, period: 28_000 },
  { brand: "x", label: "X", r: 1.42, incl: 0.46, node: 0.38, phase: 2.2, period: 36_000 },
  { brand: "linkedin", label: "LinkedIn", r: 1.42, incl: 0.46, node: 0.38, phase: 5.3, period: 36_000 },
  { brand: "facebook", label: "Facebook", r: 1.18, incl: 0.62, node: 0.08, phase: 1.1, period: 32_000 },
];
