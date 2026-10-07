// xcolor expressions: names, mixes ("blue!20", "red!50!black"), complements
// ("-red"), \definecolor models, and the "rgb,255:red,0;green,0;blue,0" form.

export type RGB = readonly [number, number, number];

/** xcolor's base colours, always available. */
const BASE: Record<string, RGB> = {
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
  cyan: [0, 1, 1],
  magenta: [1, 0, 1],
  yellow: [1, 1, 0],
  black: [0, 0, 0],
  white: [1, 1, 1],
  gray: [0.5, 0.5, 0.5],
  darkgray: [0.25, 0.25, 0.25],
  lightgray: [0.75, 0.75, 0.75],
  brown: [0.75, 0.5, 0.25],
  lime: [0.75, 1, 0],
  olive: [0.5, 0.5, 0],
  orange: [1, 0.5, 0],
  pink: [1, 0.75, 0.75],
  purple: [0.75, 0, 0.25],
  teal: [0, 0.5, 0.5],
  violet: [0.5, 0, 0.5],
};

export class ColorTable {
  private names = new Map<string, RGB>();

  /** The colour "." refers to. */
  current: RGB = [0, 0, 0];

  get(name: string): RGB | undefined {
    return this.names.get(name) ?? BASE[name];
  }

  has(name: string): boolean {
    return this.names.has(name) || name in BASE;
  }

  set(name: string, rgb: RGB): void {
    this.names.set(name, rgb);
  }

  clone(): ColorTable {
    const c = new ColorTable();
    c.names = new Map(this.names);
    c.current = this.current;
    return c;
  }

  /** \definecolor{name}{model}{spec}. Returns false for models it can't read. */
  define(name: string, model: string, spec: string): boolean {
    const rgb = fromModel(model.trim(), spec.trim());
    if (!rgb) return false;
    this.set(name.trim(), rgb);
    return true;
  }

  /** Evaluates an xcolor expression, or returns null if it isn't one. */
  parse(expr: string): RGB | null {
    let s = expr.trim();
    if (s.startsWith("{") && s.endsWith("}")) s = s.slice(1, -1).trim();
    const model = /^(rgb|RGB|HTML|gray|cmyk|cmy|Gray|HSB|hsb)\s*(?:,\s*([\d.]+))?\s*:(.*)$/.exec(s);
    if (model) return fromMixedModel(model[1]!, model[2] ? +model[2] : 1, model[3]!);
    let complement = false;
    while (s.startsWith("-")) {
      complement = !complement;
      s = s.slice(1).trim();
    }
    const parts = s.split("!").map((p) => p.trim());
    const first = this.base(parts[0]!);
    if (!first) return null;
    let color: RGB = first;
    for (let i = 1; i < parts.length; i += 2) {
      const pct = parseFloat(parts[i]!);
      if (!Number.isFinite(pct)) return null;
      const otherName = parts[i + 1];
      const other = otherName === undefined || otherName === "" ? BASE.white! : this.base(otherName);
      if (!other) return null;
      const t = Math.min(100, Math.max(0, pct)) / 100;
      color = [0, 1, 2].map((k) => color[k]! * t + other[k]! * (1 - t)) as unknown as RGB;
    }
    return complement ? (color.map((v) => 1 - v) as unknown as RGB) : color;
  }

  private base(name: string): RGB | null {
    if (name === ".") return this.current;
    return this.get(name) ?? null;
  }
}

function fromModel(model: string, spec: string): RGB | null {
  const nums = spec.split(/[,\s]+/).filter(Boolean).map(Number);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  switch (model) {
    case "rgb":
      return nums.length === 3 && nums.every(Number.isFinite) ? (nums.map(clamp) as unknown as RGB) : null;
    case "RGB":
      return nums.length === 3 && nums.every(Number.isFinite) ? (nums.map((v) => clamp(v / 255)) as unknown as RGB) : null;
    case "HTML": {
      const m = /^#?([0-9a-fA-F]{6})$/.exec(spec);
      if (!m) return null;
      const n = parseInt(m[1]!, 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    case "gray":
      return nums.length === 1 && Number.isFinite(nums[0]) ? [clamp(nums[0]!), clamp(nums[0]!), clamp(nums[0]!)] : null;
    case "Gray":
      return nums.length === 1 && Number.isFinite(nums[0]) ? [nums[0]! / 15, nums[0]! / 15, nums[0]! / 15] : null;
    case "cmyk": {
      if (nums.length !== 4 || !nums.every(Number.isFinite)) return null;
      const [c, m, y, k] = nums as [number, number, number, number];
      return [clamp(1 - Math.min(1, c + k)), clamp(1 - Math.min(1, m + k)), clamp(1 - Math.min(1, y + k))];
    }
    case "cmy":
      return nums.length === 3 && nums.every(Number.isFinite) ? (nums.map((v) => clamp(1 - v)) as unknown as RGB) : null;
    default:
      return null;
  }
}

/** "rgb,255:red,0;green,0;blue,0", as tikzcd and Mathcha write it. */
function fromMixedModel(model: string, scale: number, spec: string): RGB | null {
  if (model !== "rgb" && model !== "RGB") return fromModel(model, spec);
  const out = [0, 0, 0];
  for (const part of spec.split(";")) {
    const [name, value] = part.split(",").map((x) => x.trim());
    const base = name ? BASE[name] : undefined;
    const v = Number(value);
    if (!base || !Number.isFinite(v)) return null;
    for (let k = 0; k < 3; k++) out[k] = out[k]! + base[k]! * (v / scale);
  }
  return out.map((v) => Math.min(1, Math.max(0, v))) as unknown as RGB;
}

export function cssColor(rgb: RGB): string {
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}
