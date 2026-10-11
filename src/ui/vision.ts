// Grayscale and colorblind views of the picture (M4 step 6, D85). The
// picture is drawn through an SVG color matrix; nothing about the code, the
// exports or the interface changes. The colorblind matrices are Machado,
// Oliveira and Fernandes (2009) at full severity, which work on linear RGB, as
// SVG filters do by default (`color-interpolation-filters`).
import { signal } from "@preact/signals";

export type VisionMode = "normal" | "grayscale" | "protanopia" | "deuteranopia" | "tritanopia";

type Matrix = readonly [number, number, number, number, number, number, number, number, number];

/** The three matrices act on linear RGB; grayscale is Rec. 709 luminance in each channel. */
const MATRICES: Record<Exclude<VisionMode, "normal">, Matrix> = {
  grayscale: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

export interface VisionInfo {
  mode: VisionMode;
  label: string;
  /** What the badge over the canvas says. */
  badge: string;
}

export const VISION_MODES: readonly VisionInfo[] = [
  { mode: "normal", label: "Normal colors", badge: "" },
  { mode: "grayscale", label: "Grayscale", badge: "in grayscale, as on a black-and-white print or to someone who sees no color" },
  { mode: "protanopia", label: "Red-blind (protanopia)", badge: "by someone with protanopia (no red cones): reds look dark, red and green run together" },
  { mode: "deuteranopia", label: "Green-blind (deuteranopia)", badge: "by someone with deuteranopia (no green cones, the most common kind of color blindness): red and green run together" },
  { mode: "tritanopia", label: "Blue-blind (tritanopia)", badge: "by someone with tritanopia (no blue cones): blue and green, yellow and violet run together" },
];

const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gamma = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp = (v: number): number => Math.min(1, Math.max(0, v));

/** An sRGB color (channels 0–1) as it looks in `mode`. */
export function simulate(rgb: readonly [number, number, number], mode: VisionMode): [number, number, number] {
  if (mode === "normal") return [rgb[0], rgb[1], rgb[2]];
  const m = MATRICES[mode];
  const [r, g, b] = [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
  return [clamp(m[0] * r + m[1] * g + m[2] * b), clamp(m[3] * r + m[4] * g + m[5] * b), clamp(m[6] * r + m[7] * g + m[8] * b)].map(gamma) as [number, number, number];
}

/** The `values` of an `feColorMatrix` for `mode`, or null for normal colors. */
export function filterValues(mode: VisionMode): string | null {
  if (mode === "normal") return null;
  const m = MATRICES[mode];
  return [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0].join(" ");
}

/** The id of the filter element for a mode. */
export const filterId = (mode: VisionMode): string => `tf-vision-${mode}`;

/** How the picture is being looked at. Not kept between visits: a leftover filter would be a puzzle. */
export const visionMode = signal<VisionMode>("normal");

export const isVisionMode = (v: string): v is VisionMode => VISION_MODES.some((m) => m.mode === v);
