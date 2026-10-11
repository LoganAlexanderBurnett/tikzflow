// Mockups of three visual directions (M5 step 1, D89). Static markup only: nothing here is wired to
// the editor. `?d=a|b|c&view=home|editor|board&theme=light|dark`.
import "katex/dist/katex.min.css";
import "./base.css";
import { SAMPLE } from "../../src/ui/sample.ts";

type Dir = "a" | "b" | "c";
type View = "home" | "editor" | "board";

const params = new URLSearchParams(location.search);
const dir = (["a", "b", "c"].includes(params.get("d") ?? "") ? params.get("d") : "a") as Dir;
const view = (["home", "editor", "board"].includes(params.get("view") ?? "") ? params.get("view") : "home") as View;
const theme = params.get("theme") === "dark" ? "dark" : "light";

const loaders: Record<Dir, () => Promise<unknown>> = {
  a: () => import("./a.css"),
  b: () => import("./b.css"),
  c: () => import("./c.css"),
};

interface Direction {
  name: string;
  summary: string;
  fonts: [role: string, family: string][];
  logo: string;
  wordmark: string;
  swatches: [name: string, token: string][];
}

const LOGO_A = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="13" height="10" rx="2" fill="var(--logo-ink)"/><path d="M9.5 13V24H12.5" fill="none" stroke="var(--logo-ink)" stroke-width="2.4"/><path d="M11.5 20.3L16.2 24L11.5 27.7Z" fill="var(--logo-ink)"/><rect x="17.2" y="19.2" width="11.6" height="9.6" rx="2" fill="none" stroke="var(--logo-accent)" stroke-width="2.4"/></svg>`;
const LOGO_B = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--logo-tile)"/><path d="M16 4.5V9.5M16 22.5V25" stroke="var(--logo-mark)" stroke-width="2.2" fill="none"/><path d="M16 9.5L25 16L16 22.5L7 16Z" fill="var(--logo-mark)"/><path d="M12.6 24.4L16 28L19.4 24.4Z" fill="var(--logo-mark)"/><path d="M25 16H28.5" stroke="var(--logo-mark)" stroke-width="2.2"/></svg>`;
const LOGO_C = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="10" fill="var(--logo-tile)"/><path d="M8 7.5H19A4.25 4.25 0 0 1 19 16H13A4.25 4.25 0 0 0 13 24.5H21.5" fill="none" stroke="var(--logo-mark)" stroke-width="2.6" stroke-linecap="round"/><path d="M20.6 21.2L25 24.5L20.6 27.8Z" fill="var(--logo-mark)"/><circle cx="8" cy="7.5" r="3.1" fill="var(--logo-dot)"/></svg>`;

const DIRECTIONS: Record<Dir, Direction> = {
  a: {
    name: "A · Manuscript",
    summary:
      "Warm paper, dark ink and one vermilion accent. Serif headings echo the LaTeX documents people make with TikZ; the interface itself is a quiet sans, so the tool stays out of the way of the diagram. The mark is two nodes joined by a |- corner.",
    fonts: [
      ["Headings", "Source Serif 4"],
      ["Interface", "Source Sans 3"],
      ["Code", "Source Code Pro"],
    ],
    logo: LOGO_A,
    wordmark: `TikZ<em>Flow</em>`,
    swatches: [
      ["Paper", "--bg"],
      ["Surface", "--surface"],
      ["Ink", "--fg"],
      ["Muted", "--muted"],
      ["Rule", "--line"],
      ["Vermilion", "--accent"],
      ["Navy", "--ink-2"],
    ],
  },
  b: {
    name: "B · Blueprint",
    summary:
      "A precise technical tool: cool neutrals, one strong blue, and a faint grid behind the canvas like drafting paper. One type family, IBM Plex, for headings, interface and code. The mark is a decision diamond on a blue tile, which still reads at 16 px.",
    fonts: [
      ["Headings", "IBM Plex Sans"],
      ["Interface", "IBM Plex Sans"],
      ["Code", "IBM Plex Mono"],
    ],
    logo: LOGO_B,
    wordmark: `TikZ<b>Flow</b>`,
    swatches: [
      ["Background", "--bg"],
      ["Surface", "--surface"],
      ["Text", "--fg"],
      ["Muted", "--muted"],
      ["Line", "--line"],
      ["Blueprint", "--accent"],
      ["Grid", "--grid"],
    ],
  },
  c: {
    name: "C · Friendly",
    summary:
      "Approachable for people new to TikZ: rounded shapes, a green accent with a marigold highlight, and Atkinson Hyperlegible, a typeface designed for legibility, for the interface. Space Grotesk gives the headings some character. The mark is a flow line from a start dot.",
    fonts: [
      ["Headings", "Space Grotesk"],
      ["Interface", "Atkinson Hyperlegible Next"],
      ["Code", "JetBrains Mono"],
    ],
    logo: LOGO_C,
    wordmark: `TikZFlow`,
    swatches: [
      ["Cream", "--bg"],
      ["Surface", "--surface"],
      ["Text", "--fg"],
      ["Muted", "--muted"],
      ["Line", "--line"],
      ["Green", "--accent"],
      ["Marigold", "--highlight"],
    ],
  },
};

const D = DIRECTIONS[dir];

// ---------------------------------------------------------------------------------------------
// Icons (drawn for this mockup; 24-unit grid, stroked)

const ICONS: Record<string, string> = {
  open: "M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9.5A1.5 1.5 0 0 0 19.5 8H12l-2-2.5H4.5A1.5 1.5 0 0 0 3 7Z",
  save: "M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4ZM8 4v5h7V4M8 20v-6h8v6",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14",
  undo: "M9 7 4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12",
  redo: "M15 7l4.5 4.5L15 16M19 11.5H9.5a5 5 0 0 0 0 10H12",
  layout: "M10 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4zM12 8v4M6 16v-4h12v4",
  page: "M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V3.5ZM14 3.5V8h4M9 12h6M9 15.5h6",
  import: "M12 3.5v10M8 9.5l4 4 4-4M4.5 14v5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5",
  export: "M12 14V3.5M8 7.5l4-4 4 4M4.5 14v5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5",
  share: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  plus: "M12 5v14M5 12h14",
  chevron: "M7 10l5 5 5-5",
  close: "M7 7l10 10M17 7 7 17",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  offline: "M5 12.5l4.5 4.5L19 7.5",
  bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z",
  italic: "M10 5h8M6 19h8M14 5l-4 14",
  alignL: "M4 6h16M4 10h10M4 14h16M4 18h10",
  alignC: "M4 6h16M7 10h10M4 14h16M7 18h10",
  alignR: "M4 6h16M10 10h10M4 14h16M10 18h10",
  code: "M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5",
  shield: "M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6l-7-3Z M9 12l2.2 2.2L15.5 10",
  wand: "M4 20 14 10M14 4v3M18.5 5.5l-2 2M20 10h-3M12.5 6.5l5 5",
  file: "M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V3.5ZM14 3.5V8h4",
};

function icon(name: string, cls = "ic"): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] ?? ""}"/></svg>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function brand(compact = false): string {
  return `<a class="brand${compact ? " compact" : ""}" href="#"><span class="logo">${D.logo}</span><span class="wordmark">${D.wordmark}</span><span class="pill">Beta</span></a>`;
}

// ---------------------------------------------------------------------------------------------
// The sample diagram, drawn the way TeX draws it (Computer Modern via KaTeX's fonts, black strokes,
// the sample's xcolor fills). It is the same in every direction: it is the user's picture.

const FILL = { terminal: "#D9ECEC", process: "#EBEBFF", decision: "#FFECD9", io: "#F0F0F0" };

function arrowHead(x: number, y: number, dx: number, dy: number): string {
  // Stealth: a pointed head 10 long, 7 wide, with a notch.
  const l = 10, w = 3.6, n = 3;
  const px = -dy, py = dx;
  const bx = x - dx * l, by = y - dy * l;
  return `<path d="M${x} ${y}L${bx + px * w} ${by + py * w}L${x - dx * (l - n)} ${y - dy * (l - n)}L${bx - px * w} ${by - py * w}Z" fill="#000"/>`;
}

function line(points: [number, number][]): string {
  const a = points[points.length - 2]!, b = points[points.length - 1]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
  // The line stops inside the head, as TikZ shortens it.
  const d = points.slice(0, -1).map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") + `L${b[0] - dx * 7} ${b[1] - dy * 7}`;
  return `<path d="${d}" fill="none" stroke="#000" stroke-width="1.2"/>${arrowHead(b[0], b[1], dx, dy)}`;
}

function txt(x: number, y: number, html: string, size = 15): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="KaTeX_Main" font-size="${size}">${html}</text>`;
}
const it = (s: string): string => `<tspan font-family="KaTeX_Math" font-style="italic">${s}</tspan>`;

function sampleDiagram(opts: { selected?: boolean; guide?: boolean } = {}): string {
  const W = 56, H = 18;
  const s = 1.4;
  const parts: string[] = [];
  // start
  parts.push(`<rect x="${-W}" y="${-H}" width="${2 * W}" height="${2 * H}" rx="${H}" fill="${FILL.terminal}" stroke="#000" stroke-width="${s}"/>`, txt(0, 0, "Start"));
  // read
  parts.push(`<path d="M-62 86L-49 50L62 50L49 86Z" fill="${FILL.io}" stroke="#000" stroke-width="${s}"/>`, txt(0, 68, `Read ${it("n")}`));
  // small
  parts.push(`<path d="M0 117L64 146L0 175L-64 146Z" fill="${FILL.decision}" stroke="#000" stroke-width="${s}"/>`, txt(0, 146, `${it("n")} ≤ 1?`));
  // base
  parts.push(`<rect x="128" y="128" width="112" height="36" fill="${FILL.process}" stroke="#000" stroke-width="${s}"/>`, txt(184, 146, "Answer 1"));
  // rec
  parts.push(`<rect x="-56" y="207" width="112" height="48" fill="${FILL.process}" stroke="#000" stroke-width="${s}"/>`, txt(0, 222, "Return"), txt(0, 241, `${it("n")} · ${it("f")}(${it("n")} − 1)`));
  // stop
  parts.push(`<rect x="-56" y="287" width="112" height="36" rx="18" fill="${FILL.terminal}" stroke="#000" stroke-width="${s}"/>`, txt(0, 305, "Stop"));
  // edges
  parts.push(
    line([[0, 18], [0, 50]]),
    line([[0, 86], [0, 117]]),
    line([[64, 146], [128, 146]]),
    txt(96, 136, "yes", 13),
    line([[0, 175], [0, 207]]),
    `<text x="7" y="191" dominant-baseline="central" font-family="KaTeX_Main" font-size="13">no</text>`,
    line([[0, 255], [0, 287]]),
    line([[184, 164], [184, 305], [56, 305]]),
  );
  // The guide goes under the nodes, so it shows only between them.
  const under = opts.guide ? `<g class="overlay"><path d="M-90 146H270" class="guide"/></g>` : "";
  let overlay = "";
  if (opts.selected) {
    const hx = [128, 184, 240], hy = [128, 146, 164];
    overlay += `<rect x="124" y="124" width="120" height="44" rx="3" class="sel"/>`;
    for (const x of hx) for (const y of hy) if (!(x === 184 && y === 146)) overlay += `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" class="handle"/>`;
  }
  return `<svg class="diagram" viewBox="-100 -40 380 390" role="img" aria-label="Flowchart: compute a factorial">${under}<g>${parts.join("")}</g><g class="overlay">${overlay}</g></svg>`;
}

// ---------------------------------------------------------------------------------------------
// Template thumbnails (placeholders; the real ones will be compiled by the engine)

type Shape = "box" | "pill" | "diamond" | "circle" | "accept" | "para";
function shape(kind: Shape, x: number, y: number, w: number, h: number, fill: string): string {
  const st = `fill="${fill}" stroke="#222" stroke-width="1"`;
  switch (kind) {
    case "box": return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" ${st}/>`;
    case "pill": return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${h / 2}" ${st}/>`;
    case "diamond": return `<path d="M${x} ${y - h / 2}L${x + w / 2} ${y}L${x} ${y + h / 2}L${x - w / 2} ${y}Z" ${st}/>`;
    case "circle": return `<circle cx="${x}" cy="${y}" r="${w / 2}" ${st}/>`;
    case "accept": return `<circle cx="${x}" cy="${y}" r="${w / 2}" ${st}/><circle cx="${x}" cy="${y}" r="${w / 2 - 3}" fill="none" stroke="#222" stroke-width="1"/>`;
    case "para": return `<path d="M${x - w / 2 - 4} ${y + h / 2}L${x - w / 2 + 4} ${y - h / 2}H${x + w / 2 + 4}L${x + w / 2 - 4} ${y + h / 2}Z" ${st}/>`;
  }
}
function bar(x: number, y: number, w: number): string {
  return `<rect x="${x - w / 2}" y="${y - 1.2}" width="${w}" height="2.4" rx="1.2" fill="#555"/>`;
}
function ar(points: [number, number][]): string {
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("");
  return `<path d="${d}" fill="none" stroke="#222" stroke-width="1" marker-end="url(#ah)"/>`;
}
const T = { t: "#D9ECEC", p: "#EBEBFF", d: "#FFECD9", g: "#F0F0F0", y: "#FFF6D6", r: "#FBE3E3", k: "#E3F2E1" };

const THUMBS: [title: string, blurb: string, svg: string][] = [
  ["Basic process", "Start, input, steps and a stop, with one decision.",
    [shape("pill", 70, 16, 46, 14, T.t), bar(70, 16, 18), ar([[70, 23], [70, 33]]), shape("para", 70, 40, 46, 14, T.g), bar(70, 40, 22), ar([[70, 47], [70, 56]]),
     shape("diamond", 70, 68, 52, 24, T.d), bar(70, 68, 16), ar([[96, 68], [118, 68]]), shape("box", 142, 68, 46, 14, T.p), bar(142, 68, 22),
     ar([[70, 80], [70, 92]]), shape("box", 70, 100, 46, 16, T.p), bar(70, 100, 24), ar([[70, 108], [70, 119]]), shape("pill", 70, 126, 46, 14, T.t), bar(70, 126, 16), ar([[142, 75], [142, 126], [93, 126]])].join("")],
  ["Decision flowchart", "Yes and No branches that meet again.",
    [shape("box", 120, 16, 50, 14, T.p), bar(120, 16, 24), ar([[120, 23], [120, 34]]), shape("diamond", 120, 48, 56, 26, T.d), bar(120, 48, 18),
     ar([[92, 48], [60, 48], [60, 74]]), ar([[148, 48], [180, 48], [180, 74]]), shape("box", 60, 82, 50, 14, T.p), bar(60, 82, 22), shape("box", 180, 82, 50, 14, T.p), bar(180, 82, 26),
     ar([[60, 89], [60, 112], [94, 112]]), ar([[180, 89], [180, 112], [146, 112]]), shape("box", 120, 112, 50, 14, T.p), bar(120, 112, 20), ar([[120, 119], [120, 130]]), shape("pill", 120, 137, 40, 12, T.t)].join("")],
  ["Algorithm with a loop", "A while loop with its way back drawn as |-.",
    [shape("pill", 90, 14, 44, 12, T.t), ar([[90, 20], [90, 30]]), shape("box", 90, 37, 52, 14, T.p), bar(90, 37, 28), ar([[90, 44], [90, 55]]), shape("diamond", 90, 68, 56, 26, T.d), bar(90, 68, 18),
     ar([[90, 81], [90, 94]]), shape("box", 90, 101, 52, 14, T.p), bar(90, 101, 30), ar([[90, 108], [90, 116], [40, 116], [40, 68], [62, 68]]), ar([[118, 68], [160, 68]]), shape("pill", 182, 68, 40, 12, T.t)].join("")],
  ["Swimlane process", "Three lanes that share a top and bottom.",
    [`<rect x="12" y="8" width="72" height="134" fill="#F6F6F6" stroke="#999" stroke-width=".8"/><rect x="84" y="8" width="72" height="134" fill="#FFFFFF" stroke="#999" stroke-width=".8"/><rect x="156" y="8" width="72" height="134" fill="#F6F6F6" stroke="#999" stroke-width=".8"/>`,
     bar(48, 17, 24), bar(120, 17, 20), bar(192, 17, 28), shape("pill", 48, 40, 48, 14, T.t), ar([[72, 40], [96, 40], [96, 62]]), shape("box", 120, 70, 48, 14, T.p), ar([[144, 70], [168, 70], [168, 92]]),
     shape("diamond", 192, 102, 50, 22, T.d), ar([[192, 113], [192, 124], [72, 124], [72, 70], [70, 70]]), shape("box", 48, 70, 40, 14, T.p)].join("")],
  ["Left-to-right pipeline", "Stages grouped with fit, like a model architecture.",
    [`<rect x="40" y="30" width="80" height="90" rx="4" fill="none" stroke="#777" stroke-dasharray="3 2"/><rect x="132" y="30" width="80" height="90" rx="4" fill="none" stroke="#777" stroke-dasharray="3 2"/>`,
     shape("para", 18, 75, 18, 26, T.g), ar([[28, 75], [52, 55]]), ar([[28, 75], [52, 95]]), shape("box", 80, 55, 50, 16, T.p), shape("box", 80, 95, 50, 16, T.p), ar([[105, 55], [146, 75]]), ar([[105, 95], [146, 75]]),
     shape("box", 172, 75, 50, 18, T.k), ar([[197, 75], [216, 75]]), shape("pill", 226, 75, 14, 14, T.y), bar(80, 22, 30), bar(172, 22, 30)].join("")],
  ["Feedback block diagram", "Sum junction, controller, plant and sensor.",
    [ar([[8, 55], [38, 55]]), shape("circle", 46, 55, 16, 16, "#fff"), `<path d="M41 50l10 10M51 50l-10 10" stroke="#222" stroke-width=".8"/>`, ar([[54, 55], [76, 55]]), shape("box", 102, 55, 52, 22, T.p), bar(102, 55, 26),
     ar([[128, 55], [152, 55]]), shape("box", 178, 55, 52, 22, T.k), bar(178, 55, 20), ar([[204, 55], [234, 55]]), ar([[218, 55], [218, 104], [166, 104]]), shape("box", 140, 104, 52, 20, T.y), bar(140, 104, 22), ar([[114, 104], [46, 104], [46, 64]])].join("")],
  ["PRISMA 2020", "Records identified, screened, excluded and included.",
    [`<rect x="6" y="8" width="12" height="40" fill="#CFE0F5"/><rect x="6" y="54" width="12" height="52" fill="#CFE0F5"/><rect x="6" y="112" width="12" height="30" fill="#CFE0F5"/>`,
     shape("box", 78, 26, 92, 26, "#fff"), bar(78, 22, 60), bar(78, 30, 44), ar([[124, 26], [146, 26]]), shape("box", 190, 26, 80, 26, "#fff"), bar(190, 26, 50), ar([[78, 39], [78, 60]]), shape("box", 78, 70, 92, 20, "#fff"), bar(78, 70, 54),
     ar([[124, 70], [146, 70]]), shape("box", 190, 70, 80, 20, "#fff"), bar(190, 70, 46), ar([[78, 80], [78, 100]]), shape("box", 78, 110, 92, 20, "#fff"), bar(78, 110, 50), ar([[78, 120], [78, 124]]), shape("box", 78, 133, 92, 16, "#fff"), bar(78, 133, 40)].join("")],
  ["State machine", "States, an initial arrow, loops and accepting states.",
    [ar([[14, 75], [34, 75]]), shape("circle", 52, 75, 34, 34, T.y), bar(52, 75, 12), `<path d="M44 59C38 34 66 34 60 59" fill="none" stroke="#222" marker-end="url(#ah)"/>`, ar([[69, 70], [104, 50]]), shape("circle", 122, 45, 34, 34, T.y), bar(122, 45, 12),
     ar([[139, 50], [175, 70]]), shape("accept", 192, 77, 36, 36, T.k), bar(192, 77, 12), ar([[105, 52], [69, 79]]), `<path d="M69 85C100 125 150 120 176 90" fill="none" stroke="#222" marker-end="url(#ah)"/>`].join("")],
  ["Hierarchy", "A tree placed with positioning and -| edges.",
    [shape("box", 120, 18, 56, 16, T.p), bar(120, 18, 30), ar([[120, 26], [120, 40], [48, 40], [48, 56]]), ar([[120, 40], [120, 56]]), ar([[120, 40], [192, 40], [192, 56]]),
     shape("box", 48, 64, 50, 16, T.k), shape("box", 120, 64, 50, 16, T.k), shape("box", 192, 64, 50, 16, T.k), bar(48, 64, 24), bar(120, 64, 28), bar(192, 64, 22),
     ar([[30, 72], [30, 100], [40, 100]]), ar([[30, 100], [30, 126], [40, 126]]), shape("box", 60, 100, 38, 14, T.g), shape("box", 60, 126, 38, 14, T.g), ar([[174, 72], [174, 100], [184, 100]]), shape("box", 204, 100, 38, 14, T.g)].join("")],
];

function thumb(svg: string): string {
  return `<svg viewBox="0 0 240 150" aria-hidden="true"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1L10 5L0 9L3 5Z" fill="#222"/></marker></defs>${svg}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Code highlighting (enough for the mockup)

const KEYWORDS = new Set(["\\node", "\\draw", "\\begin", "\\end", "\\tikzset", "\\usetikzlibrary", "\\documentclass"]);
function highlight(lineText: string): string {
  const re = /(%.*$)|(\\[A-Za-z]+)|(\((?:[A-Za-z]+)\))|([A-Za-z][A-Za-z ]*?(?=\s*=)|[a-z]+(?=\/\.style))|(\$[^$]*\$)|([{}[\]])/g;
  let out = "", last = 0;
  for (const m of lineText.matchAll(re)) {
    out += esc(lineText.slice(last, m.index));
    const t = esc(m[0]);
    if (m[1]) out += `<span class="t-com">${t}</span>`;
    else if (m[2]) out += `<span class="${KEYWORDS.has(m[0]) ? "t-kw" : "t-mac"}">${t}</span>`;
    else if (m[3]) out += `<span class="t-name">${t}</span>`;
    else if (m[4]) out += `<span class="t-key">${t}</span>`;
    else if (m[5]) out += `<span class="t-val">${t}</span>`;
    else out += `<span class="t-punct">${t}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(lineText.slice(last));
}

function codePane(): string {
  const lines = SAMPLE.replace(/\n$/, "").split("\n");
  const rows = lines
    .map((l, i) => {
      const sel = l.includes("(base)  {Answer");
      return `<div class="cl${sel ? " sel" : ""}"><span class="ln">${i + 1}</span><span class="lc">${highlight(l) || " "}</span></div>`;
    })
    .join("");
  return `<section class="pane code" aria-label="Code"><div class="pane-head"><span>${icon("code", "ic sm")} Code</span><span class="muted">LaTeX · UTF-8</span></div><div class="code-body">${rows}</div></section>`;
}

// ---------------------------------------------------------------------------------------------
// Views

function siteHeader(): string {
  return `<header class="site-head">
    ${brand()}
    <nav class="site-nav"><a href="#">Templates</a><a href="#">Help</a><a href="#">Source code</a></nav>
    <div class="head-actions">
      <button class="icon-btn" aria-label="Switch theme">${icon(theme === "dark" ? "sun" : "moon")}</button>
      <a class="btn primary" href="#">Open the editor</a>
    </div>
  </header>`;
}

function home(): string {
  const cards = THUMBS.map(([title, blurb, svg]) => `<a class="tcard" href="#"><div class="thumb">${thumb(svg)}</div><div class="tmeta"><strong>${esc(title)}</strong><span>${esc(blurb)}</span></div></a>`).join("");
  return `<div class="site">
  ${siteHeader()}
  <main>
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">Free and open source · runs in your browser</p>
        <h1>Draw flowcharts.<br/>Keep your TikZ.</h1>
        <p class="lede">A visual editor for TikZ flowcharts where the code and the canvas stay in sync. Dragging a node writes <code>right=of small</code>, not coordinates, and everything you didn't touch, comments and macros included, stays exactly as you wrote it.</p>
        <div class="cta">
          <a class="btn primary lg" href="#">Continue your diagram</a>
          <a class="btn lg" href="#">${icon("plus", "ic sm")} New diagram</a>
        </div>
        <p class="resume">${icon("file", "ic sm")} <span><strong>factorial.tex</strong> · edited 2 hours ago · 2 more in this browser</span></p>
      </div>
      <div class="hero-visual">
        <div class="hv-code">${codeSnippet()}</div>
        <div class="hv-canvas">${sampleDiagram({ selected: true, guide: true })}</div>
        <div class="hv-badge">${icon("offline", "ic sm")} 1 line changed</div>
      </div>
    </section>

    <section class="band features">
      <div class="feature"><span class="f-ic">${icon("code")}</span><h3>Lossless round trips</h3><p>Visual edits become small text patches. Anything the editor doesn't understand is kept verbatim and drawn by TeX.</p></div>
      <div class="feature"><span class="f-ic">${icon("wand")}</span><h3>Code that reads hand-written</h3><p>Relative positioning, named styles in <code>\\tikzset</code>, meaningful node names and managed libraries.</p></div>
      <div class="feature"><span class="f-ic">${icon("page")}</span><h3>Real TeX preview</h3><p>An instant drawing while you drag, then the real compile from a TeX engine in your browser, with errors mapped to lines.</p></div>
    </section>

    <section class="templates" id="templates">
      <div class="sec-head"><h2>Start from a template</h2><p>Each one is plain, idiomatic TikZ you can edit visually or as code. It opens in a new tab.</p></div>
      <div class="tgrid">${cards}</div>
    </section>

    <section class="privacy">
      <div class="p-ic">${icon("shield")}</div>
      <div>
        <h2>Your diagrams never leave your browser</h2>
        <p>No account, no server, no tracking. Your work is saved in this browser, the TeX engine runs on your computer, and share links carry the code in the part of the address that is never sent anywhere. After your first visit it works offline.</p>
      </div>
    </section>

    <section class="start">
      <div class="sec-head"><h2>Getting started</h2></div>
      <ol class="steps">
        <li><span class="num">1</span><div><strong>Paste or open TikZ</strong><p>A bare <code>tikzpicture</code> or a whole <code>.tex</code> file. Or start blank, or from a template.</p></div></li>
        <li><span class="num">2</span><div><strong>Edit on the canvas or in the code</strong><p>Drag nodes, draw edges from anchors, press Tab to add a connected step. Both sides follow.</p></div></li>
        <li><span class="num">3</span><div><strong>Take it to your paper</strong><p>Export a standalone <code>.tex</code>, a snippet, PDF, SVG or PNG, or share a link.</p></div></li>
      </ol>
      <p class="tip">Tip: bookmark <code>tikzflow.pages.dev/editor/</code> to go straight to the editor.</p>
    </section>
  </main>
  <footer class="site-foot">
    <div>${brand(true)}</div>
    <div class="foot-links"><a href="#">Help</a><a href="#">Report a problem</a><a href="#">Source code</a><span>GPL-3.0-or-later</span></div>
  </footer>
</div>`;
}

function codeSnippet(): string {
  const lines = [
    "  \\node[decision, below=of read] (small) {$n \\le 1$?};",
    "  \\node[process, right=of small] (base)  {Answer $1$};",
    "  \\node[process, below=of small] (rec)   {Return\\\\ $n \\cdot f(n-1)$};",
  ];
  return `<div class="snip-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span>factorial.tex</span></div>` +
    lines.map((l, i) => `<div class="cl${i === 1 ? " sel" : ""}"><span class="ln">${21 + i}</span><span class="lc">${highlight(l)}</span></div>`).join("");
}

function editor(): string {
  const tools = (items: [string, string][]): string => items.map(([ic, label]) => `<button class="tb">${icon(ic, "ic sm")}<span>${label}</span></button>`).join("");
  return `<div class="app">
  <header class="app-bar">
    ${brand(true)}
    <nav class="tabs" aria-label="Open diagrams">
      <button class="tab active"><span>factorial.tex</span>${icon("close", "ic xs")}</button>
      <button class="tab"><span>pipeline.tex</span><span class="dirty">●</span></button>
      <button class="tab"><span>Untitled</span></button>
      <button class="tab add" aria-label="New tab">${icon("plus", "ic sm")}</button>
    </nav>
    <div class="bar-right">
      <a class="link" href="#">Report a problem</a>
      <button class="icon-btn" aria-label="Help">${icon("help")}</button>
      <button class="icon-btn" aria-label="Switch theme">${icon(theme === "dark" ? "sun" : "moon")}</button>
    </div>
  </header>
  <div class="toolbar">
    <div class="tgroup"><button class="tb">${icon("plus", "ic sm")}<span>New</span>${icon("chevron", "ic xs")}</button>${tools([["open", "Open…"], ["save", "Save"], ["download", "Download"]])}</div>
    <div class="tgroup">${`<button class="tb icon-only" aria-label="Undo">${icon("undo", "ic sm")}</button><button class="tb icon-only" aria-label="Redo">${icon("redo", "ic sm")}</button>`}</div>
    <div class="tgroup">${tools([["import", "Import"], ["layout", "Layout"], ["page", "Page"]])}</div>
    <div class="spacer"></div>
    <div class="tgroup"><label class="switch"><span class="knob on"></span><span>TeX preview</span></label><button class="tb">Normal colors${icon("chevron", "ic xs")}</button><button class="tb icon-only" aria-label="Fit">${icon("fit", "ic sm")}</button></div>
    <div class="tgroup">${tools([["export", "Export"]])}<button class="tb primary">${icon("share", "ic sm")}<span>Share</span></button></div>
  </div>
  <main class="work">
    ${codePane()}
    <section class="pane canvas" aria-label="Canvas">
      <div class="summary"><span><strong>6 nodes and 6 edges</strong> editable</span><span class="chip ok">${icon("offline", "ic xs")} TeX preview 0.21 s</span></div>
      <div class="palette"><span class="pal-label">Add</span>
        <button class="pal"><svg viewBox="0 0 28 16"><rect x="2" y="3" width="24" height="10" fill="none" stroke="currentColor"/></svg>Process</button>
        <button class="pal"><svg viewBox="0 0 28 16"><path d="M14 1L26 8L14 15L2 8Z" fill="none" stroke="currentColor"/></svg>Decision</button>
        <button class="pal"><svg viewBox="0 0 28 16"><rect x="2" y="3" width="24" height="10" rx="5" fill="none" stroke="currentColor"/></svg>Terminal</button>
        <button class="pal"><svg viewBox="0 0 28 16"><path d="M5 13L8 3H26L23 13Z" fill="none" stroke="currentColor"/></svg>I/O</button>
        <button class="pal"><svg viewBox="0 0 28 16"><circle cx="14" cy="8" r="5" fill="none" stroke="currentColor"/></svg>Connector</button>
        <button class="pal"><svg viewBox="0 0 28 16"><path d="M3 3H25V12C19 9 9 16 3 12Z" fill="none" stroke="currentColor"/></svg>Document</button>
      </div>
      <div class="stage"><div class="paper">${sampleDiagram({ selected: true, guide: true })}</div>
        <div class="zoom"><button aria-label="Zoom out">−</button><span>100%</span><button aria-label="Zoom in">+</button></div>
      </div>
    </section>
    <aside class="pane inspector" aria-label="Properties">
      <div class="pane-head"><span>Node <code>base</code></span><span class="muted">style process</span></div>
      <div class="insp-body">
        <div class="scope"><button class="seg on">This node</button><button class="seg">All process nodes</button></div>
        <div class="field"><label>Fill</label><span class="swatch" style="background:#EBEBFF"></span><code>blue!8</code></div>
        <div class="field"><label>Outline</label><span class="swatch" style="background:#000"></span><code>black</code></div>
        <div class="field"><label>Text</label><span class="swatch" style="background:#000"></span><code>black</code></div>
        <div class="field"><label>Font</label><button class="select">Normal size${icon("chevron", "ic xs")}</button><button class="mini">${icon("bold", "ic sm")}</button><button class="mini">${icon("italic", "ic sm")}</button></div>
        <div class="field"><label>Align</label><div class="segs"><button class="mini">${icon("alignL", "ic sm")}</button><button class="mini on">${icon("alignC", "ic sm")}</button><button class="mini">${icon("alignR", "ic sm")}</button></div></div>
        <div class="field"><label>Size</label><code>28 × 9 mm</code><button class="link-btn">Match width</button></div>
        <h4>Styles <span class="count">5</span></h4>
        <ul class="styles">
          <li><code>base</code><span>used by 4 styles</span></li>
          <li><code>terminal</code><span>2 nodes</span></li>
          <li class="on"><code>process</code><span>2 nodes</span></li>
          <li><code>decision</code><span>1 node</span></li>
          <li><code>io</code><span>1 node</span></li>
        </ul>
      </div>
    </aside>
  </main>
  <footer class="status"><span>Moved <code>base</code>: <code>right=of small</code> · 1 line changed</span><span class="status-right"><span>${icon("offline", "ic xs")} Works offline</span><span>Ln 22, Col 3</span></span></footer>
</div>`;
}

function board(): string {
  const sw = D.swatches
    .map(([n, t]) => `<div class="sw"><span class="chip-c" style="background:var(${t})"></span><strong>${n}</strong><code class="hex" data-token="${t}"></code></div>`)
    .join("");
  const fonts = D.fonts.map(([r, f]) => `<div class="font-row"><span class="role">${r}</span><span class="fam">${f}</span></div>`).join("");
  return `<div class="board">
  <header class="board-head"><h1>${D.name}</h1><p>${D.summary}</p></header>
  <div class="board-grid">
    <section class="card logo-card">
      <h3>Logo and favicon</h3>
      <div class="logo-row"><div class="logo-big">${D.logo}</div><div class="logo-lockup">${brand()}</div></div>
      <div class="fav-row">
        <div class="fake-tab"><span class="fav16">${D.logo}</span><span>TikZFlow editor</span>${icon("close", "ic xs")}</div>
        <div class="fav-sizes"><span class="f16">${D.logo}</span><span class="f32">${D.logo}</span><span class="f64">${D.logo}</span><span class="cap">16, 32, 64 px</span></div>
      </div>
    </section>
    <section class="card">
      <h3>Palette (${theme})</h3>
      <div class="swatches">${sw}</div>
    </section>
    <section class="card type-card">
      <h3>Type</h3>
      ${fonts}
      <div class="spec-display">Draw flowcharts. Keep your TikZ.</div>
      <div class="spec-ui">Drag nodes to move them. Hold Alt to drag without snapping. Tab adds a connected node.</div>
      <div class="spec-code">${highlight("\\node[process, right=of small] (base) {Answer $1$};")}</div>
    </section>
    <section class="card comp-card">
      <h3>Controls</h3>
      <div class="comp-row"><a class="btn primary" href="#">Open the editor</a><a class="btn" href="#">New diagram</a><span class="pill">Beta</span></div>
      <div class="comp-row"><label class="switch"><span class="knob on"></span><span>TeX preview</span></label><div class="scope"><button class="seg on">This node</button><button class="seg">All process nodes</button></div></div>
      <div class="comp-row"><span class="chip ok">${icon("offline", "ic xs")} Works offline</span><span class="chip warn">2 notes</span><span class="chip err">1 error</span><input class="input" value="Search help"/></div>
    </section>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------------------------

document.documentElement.dataset.dir = dir;
document.documentElement.dataset.theme = theme;
document.documentElement.dataset.view = view;
await loaders[dir]();
const root = document.getElementById("root")!;
root.innerHTML = view === "home" ? home() : view === "editor" ? editor() : board();
for (const el of root.querySelectorAll<HTMLElement>(".hex")) {
  el.textContent = getComputedStyle(document.documentElement).getPropertyValue(el.dataset.token ?? "").trim().toUpperCase();
}
await document.fonts.ready;
document.documentElement.dataset.ready = "1";
