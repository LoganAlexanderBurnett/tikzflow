// The home page (D89, D92): static HTML (index.html) with two things only a script can do: offer
// "Continue your diagram" when this browser has saved work, and the theme switch. It also registers
// the service worker, so the site's pages work offline; only the editor fetches the TeX engine.
import "../theme/theme.css";
import "./site.css";
import { bindThemeButton } from "../theme/theme.ts";
import { peekSession } from "../ui/kv.ts";
import { registerServiceWorker } from "../ui/offline.ts";
import { isPristine } from "../templates/index.ts";

for (const b of document.querySelectorAll<HTMLElement>("[data-theme-switch]")) bindThemeButton(b);
registerServiceWorker();

const ago = (ms: number): string => {
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const s = (ms - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [["second", 60], ["minute", 60], ["hour", 24], ["day", 7], ["week", 4.35], ["month", 12], ["year", Infinity]];
  let v = s;
  for (const [unit, size] of steps) {
    if (Math.abs(v) < size) return rtf.format(Math.round(v), unit);
    v /= size;
  }
  return "";
};

void peekSession().then((s) => {
  // A template untouched (the sample is one), or nothing at all, isn't work to continue.
  if (!s || !s.text.trim() || isPristine(s.text)) return;
  const cont = document.querySelector<HTMLElement>("[data-continue]");
  const open = document.querySelector<HTMLElement>("[data-open]");
  const resume = document.querySelector<HTMLElement>("[data-resume]");
  if (!cont || !open || !resume) return;
  cont.hidden = false;
  open.hidden = true;
  const name = document.createElement("strong");
  name.textContent = s.fileName ?? "Untitled diagram";
  resume.replaceChildren(name, document.createTextNode(Number.isFinite(s.savedAt) ? `, edited ${ago(s.savedAt)}` : ""));
  resume.hidden = false;
});
