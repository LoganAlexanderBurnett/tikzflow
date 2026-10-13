// The templates (D89 item 4, D95): hand-written TikZ in src/templates/<id>.tex. Each one opens with
// nothing kept as-is, and CI compiles it with pdfLaTeX (test.yml) and with our engine (its thumbnail,
// src/site/thumbs/<id>.svg, made by npm run site:assets and checked by test/templates.test.ts).
// This list has no TeX in it, so Node scripts can read it; src/templates/index.ts adds the text.

export interface TemplateInfo {
  id: string;
  title: string;
  /** One line for the gallery. `code` is written in backticks. */
  blurb: string;
  /** A heading the gallery and the New menu put above this template (and the ones after it until the next heading): D101. */
  section?: string;
}

/** The heading over the neural-network templates (D101). */
export const NEURAL_SECTION = "Neural networks";
/** The heading over diagrams that aren't flowcharts or networks (D104 item 4). */
export const OTHER_SECTION = "Other diagrams";

export const TEMPLATES: readonly TemplateInfo[] = [
  { id: "basic-process", title: "Basic process", blurb: "Start, input, steps and a stop, with one decision." },
  { id: "decision-flowchart", title: "Decision flowchart", blurb: "Yes and No branches that meet again." },
  { id: "algorithm-with-a-loop", title: "Algorithm with a loop", blurb: "A while loop, with its way back drawn as `|-`." },
  { id: "swimlane-process", title: "Swimlane process", blurb: "Three lanes that share a top and bottom." },
  { id: "left-to-right-pipeline", title: "Left-to-right pipeline", blurb: "Stages grouped with `fit`, like a model architecture." },
  { id: "feedback-block-diagram", title: "Feedback block diagram", blurb: "Sum junction, controller, plant and sensor." },
  { id: "prisma-2020", title: "PRISMA 2020", blurb: "Records identified, screened, excluded and included." },
  { id: "state-machine", title: "State machine", blurb: "States, an initial arrow, loops and an accepting state." },
  { id: "hierarchy", title: "Hierarchy", blurb: "A tree placed with positioning and `-|` edges." },
  // Neural networks (M5 step 8, D96 item 4, D100): what the editor handles today, before Milestone 7.
  { id: "neural-network", title: "Neural network", blurb: "A small fully connected network, every weight its own edge.", section: NEURAL_SECTION },
  { id: "lstm-cell", title: "LSTM cell", blurb: "Gates, pointwise operations and the cell state." },
  { id: "encoder-decoder", title: "Encoder–decoder", blurb: "Feature maps by size, with skip connections on top." },
  // Other diagrams (M6, D104 item 4, D106): circle nodes filled at 30% opacity, so the overlaps show and every set can be dragged.
  { id: "venn", title: "Venn diagram", blurb: "Three overlapping sets, with a count in each region.", section: OTHER_SECTION },
];

/** The empty diagram the New menu offers before the templates (src/templates/blank.tex). */
export const BLANK_ID = "blank";
