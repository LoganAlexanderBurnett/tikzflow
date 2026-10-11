// M4 step 6 (D85): the grayscale and colorblind views.
import { describe, expect, it } from "vitest";
import { contrastRatio, luminance } from "../src/edit/contrast.ts";
import { filterId, filterValues, isVisionMode, simulate, VISION_MODES, type VisionMode } from "../src/ui/vision.ts";

const MODES: Array<Exclude<VisionMode, "normal">> = ["grayscale", "protanopia", "deuteranopia", "tritanopia"];

describe("the color matrices", () => {
  it("leave white and black alone: a row of each matrix sums to 1", () => {
    for (const mode of MODES) {
      const white = simulate([1, 1, 1], mode);
      expect(white[0]).toBeCloseTo(1, 4);
      expect(white[1]).toBeCloseTo(1, 4);
      expect(white[2]).toBeCloseTo(1, 4);
      expect(simulate([0, 0, 0], mode)).toEqual([0, 0, 0]);
    }
  });

  it("make grayscale equal in every channel, with the luminance of the color", () => {
    for (const c of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.8, 0.3, 0.5]] as const) {
      const g = simulate(c, "grayscale");
      expect(g[0]).toBeCloseTo(g[1], 6);
      expect(g[1]).toBeCloseTo(g[2], 6);
      // The gray has the same luminance as the color it stands for.
      expect(luminance(g)).toBeCloseTo(luminance(c), 4);
    }
  });

  it("turns red and green into near-equal colors for red-blind and green-blind viewers, and not for the others", () => {
    const red: [number, number, number] = [0.8, 0.1, 0.1];
    const green: [number, number, number] = [0.1, 0.55, 0.1];
    const gap = (mode: VisionMode) => {
      const a = simulate(red, mode);
      const b = simulate(green, mode);
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };
    expect(gap("deuteranopia")).toBeLessThan(0.5 * gap("normal"));
    expect(gap("protanopia")).toBeLessThan(0.65 * gap("normal"));
  });

  it("make pure red dark for the red-blind, and leave blue alone for them", () => {
    const red = simulate([1, 0, 0], "protanopia");
    expect(luminance(red)).toBeLessThan(luminance([1, 0, 0]));
    const blue = simulate([0, 0, 1], "protanopia");
    expect(blue[2]).toBeGreaterThan(0.9);
  });

  it("make blue and green hard to tell apart for the blue-blind", () => {
    const a = simulate([0, 0.6, 0.6], "tritanopia");
    const b = simulate([0.1, 0.7, 0.3], "tritanopia");
    const normal = Math.hypot(0 - 0.1, 0.6 - 0.7, 0.6 - 0.3);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(normal);
  });

  it("keep a grayscale picture's contrast as it was", () => {
    const text: [number, number, number] = [0.2, 0.2, 0.2];
    const back: [number, number, number] = [0.95, 0.95, 0.8];
    expect(contrastRatio(simulate(text, "grayscale"), simulate(back, "grayscale"))).toBeCloseTo(contrastRatio(text, back), 1);
  });
});

describe("the filters", () => {
  it("write a 4×5 matrix for each mode, and none for normal", () => {
    expect(filterValues("normal")).toBeNull();
    for (const mode of MODES) {
      const v = filterValues(mode)!.split(" ").map(Number);
      expect(v).toHaveLength(20);
      // Alpha is untouched.
      expect(v.slice(15)).toEqual([0, 0, 0, 1, 0]);
    }
    expect(filterId("deuteranopia")).toBe("tf-vision-deuteranopia");
  });

  it("list every mode once, normal first, each with a label", () => {
    expect(VISION_MODES.map((m) => m.mode)).toEqual(["normal", "grayscale", "protanopia", "deuteranopia", "tritanopia"]);
    for (const m of VISION_MODES.slice(1)) expect(m.badge.length).toBeGreaterThan(10);
    expect(isVisionMode("grayscale")).toBe(true);
    expect(isVisionMode("sepia")).toBe(false);
  });
});
