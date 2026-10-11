// Contrast warnings for text on fills (M4 step 6, D85): WCAG AA, which wants
// 4.5:1 between text and what it sits on, or 3:1 for large text (18pt, or 14pt
// bold). A node's text is checked against its fill; text with no fill under it
// sits on whatever is drawn behind it (a lane, a group) or on the white page.
// The picture's own colors are the user's to choose: this only says so.
import type { RGB } from "../tikz/colors.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { shapeBounds } from "../tikz/shapes.ts";

export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;
const WHITE: RGB = [1, 1, 1];
const BLACK: RGB = [0, 0, 0];

const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** WCAG's relative luminance of an sRGB color (channels 0–1). */
export function luminance(c: RGB): number {
  return 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
}

/** WCAG's contrast ratio of two colors, from 1 to 21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `fg` over `bg` at opacity `alpha`. */
export function blend(fg: RGB, bg: RGB, alpha: number): RGB {
  const a = Math.min(1, Math.max(0, alpha));
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
}

/** WCAG's "large text": 18pt, or 14pt and bold. */
export function isLargeText(sizePt: number, bold: boolean): boolean {
  return sizePt >= 18 || (bold && sizePt >= 14);
}

/** Black or white text, whichever reads better on `background`, with the ratio it gets. */
export function betterText(background: RGB): { name: "black" | "white"; ratio: number } {
  const onBlack = contrastRatio(BLACK, background);
  const onWhite = contrastRatio(WHITE, background);
  return onBlack >= onWhite ? { name: "black", ratio: onBlack } : { name: "white", ratio: onWhite };
}

export interface ContrastIssue {
  /** The node's id (a path label's too). */
  id: string;
  name?: string;
  /** Its label as written, cut short. */
  label: string;
  ratio: number;
  required: number;
  large: boolean;
  text: RGB;
  background: RGB;
  /** What the text sits on. */
  on: "fill" | "behind" | "page";
  /** A label on an edge rather than a node. */
  edgeLabel: boolean;
}

/** Nodes in the order they are drawn: background layer first, then source order. */
function inDrawOrder(nodes: readonly LaidOutNode[]): LaidOutNode[] {
  return [...nodes].sort((a, b) => a.layer - b.layer || a.syntax.from - b.syntax.from);
}

/** Every node, path labels included, with text that fails AA, in the order they are drawn. */
export function contrastIssues(layout: PictureLayout): ContrastIssue[] {
  const drawn = inDrawOrder([...layout.nodes, ...layout.pathNodes]);
  const filled = drawn.filter((n) => n.fill && !n.shading && n.shape.kind !== "coordinate");
  const indexOf = new Map(drawn.map((n, i) => [n.id, i]));
  const color = new Map<string, RGB>();

  /** What is seen at `n`'s center just before `n` is drawn: the fill behind it, or the page. */
  const behind = (n: LaidOutNode): { color: RGB; from: "behind" | "page" } => {
    const at = n.shape.center;
    const mine = indexOf.get(n.id)!;
    for (let i = filled.length - 1; i >= 0; i--) {
      const m = filled[i]!;
      if (m.id === n.id || indexOf.get(m.id)! >= mine) continue;
      const b = shapeBounds(m.shape);
      if (at.x >= b.minX && at.x <= b.maxX && at.y >= b.minY && at.y <= b.maxY) return { color: effective(m), from: "behind" };
    }
    return { color: WHITE, from: "page" };
  };
  /** A filled node's fill as seen, over what is behind it. */
  const effective = (n: LaidOutNode): RGB => {
    const known = color.get(n.id);
    if (known) return known;
    const c = n.fillOpacity >= 1 ? n.fill! : blend(n.fill!, behind(n).color, n.fillOpacity);
    color.set(n.id, c);
    return c;
  };

  const issues: ContrastIssue[] = [];
  for (const n of drawn) {
    if (n.shape.kind === "coordinate" || !n.text) continue;
    const runs = n.text.lines.flatMap((l) => l.runs).filter((r) => r.kind === "math" || (r.kind === "text" && r.text.trim()));
    if (!runs.length) continue;
    const under = n.fill && !n.shading ? { color: effective(n), from: "fill" as const } : n.shading ? null : behind(n);
    if (!under) continue;
    // The run with the least to spare decides.
    let worst: { ratio: number; required: number; large: boolean; text: RGB } | null = null;
    for (const r of runs) {
      const text = r.style.color ?? n.textColor;
      const large = isLargeText(r.style.size, r.style.bold);
      const required = large ? AA_LARGE : AA_NORMAL;
      const ratio = contrastRatio(text, under.color);
      if (!worst || ratio / required < worst.ratio / worst.required) worst = { ratio, required, large, text };
    }
    if (!worst || worst.ratio >= worst.required) continue;
    const label = (n.syntax.label?.text ?? "").replace(/\s+/g, " ").trim();
    const issue: ContrastIssue = {
      id: n.id,
      label: label.length > 30 ? `${label.slice(0, 29)}…` : label,
      ratio: worst.ratio,
      required: worst.required,
      large: worst.large,
      text: worst.text,
      background: under.color,
      on: under.from,
      edgeLabel: n.kind === "path",
    };
    if (n.name) issue.name = n.name;
    issues.push(issue);
  }
  return issues;
}

/** "2.3:1", to one decimal, rounded down so a ratio just under the limit never reads as passing. */
export function formatRatio(r: number): string {
  return `${(Math.floor(r * 10) / 10).toFixed(1)}:1`;
}
