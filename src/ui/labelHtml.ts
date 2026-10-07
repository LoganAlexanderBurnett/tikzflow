// Renders a laid-out label as HTML for an SVG foreignObject. Positions come
// from the label layout (Computer Modern metrics); the browser only draws.
import katex from "katex";
import type { Macro, Run, TextLayout, TextStyle } from "../text/label.ts";
import { cssColor } from "../tikz/colors.ts";

const FAMILY: Record<TextStyle["family"], string> = {
  rm: "KaTeX_Main",
  sf: "KaTeX_SansSerif",
  tt: "KaTeX_Typewriter",
};

/** Distance from the top of a line box to the baseline, per pt of font size, for line-height 1. */
const baselineRatio = new Map<string, number>();

/** Measures where the browser puts the baseline. Call again after fonts load. */
export function calibrateBaselines(): void {
  if (typeof document === "undefined") return;
  baselineRatio.clear();
  for (const family of Object.values(FAMILY)) {
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;font:100px/1 ${family};white-space:pre`;
    const text = document.createElement("span");
    text.textContent = "Hg";
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    box.append(text, probe);
    document.body.append(box);
    const ratio = (probe.getBoundingClientRect().top - box.getBoundingClientRect().top) / 100;
    box.remove();
    if (ratio > 0.2 && ratio < 1.5) baselineRatio.set(family, ratio);
  }
}

function ratio(family: string): number {
  return baselineRatio.get(family) ?? 0.75;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function styleCss(st: TextStyle): string {
  const parts = [`font-family:${FAMILY[st.family]}`, `font-size:${st.size * (st.script ? 0.7 : 1)}px`];
  if (st.bold) parts.push("font-weight:700");
  if (st.italic) parts.push("font-style:italic");
  if (st.smallcaps) parts.push("font-variant:small-caps");
  if (st.underline) parts.push("text-decoration:underline");
  if (st.color) parts.push(`color:${cssColor(st.color)}`);
  if (st.script) parts.push(`vertical-align:${st.script > 0 ? "0.4em" : "-0.15em"}`);
  return parts.join(";");
}

const mathCache = new Map<string, string>();

function mathHtml(tex: string, display: boolean, macros: Record<string, string>): string {
  const key = `${display}${JSON.stringify(macros)}${tex}`;
  let html = mathCache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(tex, { displayMode: false, throwOnError: false, strict: "ignore", macros: { ...macros }, output: "html" });
    } catch {
      html = `<span class="tf-bad">${escape(tex)}</span>`;
    }
    if (mathCache.size > 2000) mathCache.clear();
    mathCache.set(key, html);
  }
  return html;
}

function runHtml(r: Run, macros: Record<string, string>): string {
  const css = styleCss(r.style);
  if (r.kind === "math") return `<span style="${css}">${mathHtml(r.tex, r.display, macros)}</span>`;
  if (r.kind === "unknown") return `<span class="tf-unknown" style="${css}" title="Not understood by the native preview">${escape(r.text)}</span>`;
  return `<span style="${css}">${escape(r.text)}</span>`;
}

export function katexMacros(macros: ReadonlyMap<string, Macro>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, m] of macros) if (m.defaultArg === undefined) out[name] = m.body;
  return out;
}

/** HTML for a label, positioned in a box of the layout's width and height + depth. */
export function labelHtml(layout: TextLayout, macros: Record<string, string>): string {
  return layout.lines
    .map((line) => {
      if (!line.runs.length) return "";
      const size = Math.max(...line.runs.map((r) => r.style.size));
      const family = FAMILY[line.runs[0]!.style.family];
      const top = line.baseline - ratio(family) * size;
      return (
        `<div class="tf-line" style="left:${line.x}px;top:${top}px;font-size:${size}px;font-family:${family}">` +
        line.runs.map((r) => runHtml(r, macros)).join("") +
        "</div>"
      );
    })
    .join("");
}
