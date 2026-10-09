import "katex/dist/katex.min.css";
import "./ui/styles.css";
import { render } from "preact";
import { App } from "./ui/app.tsx";
import { calibrateBaselines } from "./ui/labelHtml.ts";
import { decode } from "./source/encoding.ts";
import { listenForLinks, restoreOnStart, startAutosave } from "./ui/files.ts";
import { registerServiceWorker } from "./ui/offline.ts";
import * as store from "./ui/store.ts";

const { fitRequests } = store;

// The work kept from the last visit, or a shared link, is the editor's first document (M3 steps 12 and 13, D74).
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
  (window as unknown as { tikzflow: object }).tikzflow = { store, decode };
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
