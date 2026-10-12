import "katex/dist/katex.min.css";
import "./theme/theme.css";
import "./ui/styles.css";
import { render } from "preact";
import { App } from "./ui/app.tsx";
import { calibrateBaselines } from "./ui/labelHtml.ts";
import { decode } from "./source/encoding.ts";
import { listenForLinks, restoreOnStart } from "./ui/files.ts";
import { registerServiceWorker } from "./ui/offline.ts";
import * as preview from "./ui/preview.ts";
import * as store from "./ui/store.ts";
import * as tabs from "./ui/tabs.ts";
import { startAutosave } from "./ui/tabs.ts";

const { fitRequests } = store;

// The tabs kept from the last visit, and a shared link, are read before the editor renders (D74, D97).
void restoreOnStart()
  .catch(() => {})
  .then(() => {
    render(<App />, document.getElementById("app")!);
    registerServiceWorker();
    startAutosave();
    listenForLinks();
  });

// A handle for end-to-end tests and debugging, in development builds only.
if (import.meta.env.DEV) {
  (window as unknown as { tikzflow: object }).tikzflow = { store, decode, tabs, preview };
}

// Labels use KaTeX's Computer Modern fonts. Measure baselines once they load,
// then redraw.
const faces = ["KaTeX_Main", "KaTeX_Math", "KaTeX_SansSerif", "KaTeX_Typewriter"];
void Promise.all([
  ...faces.map((f) => document.fonts.load(`10px ${f}`)),
  document.fonts.load("bold 10px KaTeX_Main"),
  document.fonts.load("italic 10px KaTeX_Main"),
]).then(() => {
  calibrateBaselines();
  fitRequests.value++;
});
