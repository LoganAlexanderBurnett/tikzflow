// The grayscale and colorblind views (M4 step 6, D85): the toolbar's choice,
// the SVG filter the canvas draws the picture through, and the note over the
// canvas that says the picture is being shown that way (and the code isn't).

import { filterId, filterValues, isVisionMode, VISION_MODES, visionMode } from "./vision.ts";

export function VisionSelect() {
  return (
    <label class="picker tf-vision-select" title="Look at the picture as it appears in grayscale, or to someone with a kind of color blindness. Only the preview changes: the code and the exports stay as they are.">
      View{" "}
      <select
        value={visionMode.value}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (isVisionMode(v)) visionMode.value = v;
        }}
        data-testid="vision-select"
        aria-label="View the picture in"
      >
        {VISION_MODES.map((m) => (
          <option value={m.mode}>{m.label}</option>
        ))}
      </select>
    </label>
  );
}

/** The filter for the chosen view, in the canvas's <defs>. */
export function VisionFilter() {
  const mode = visionMode.value;
  const values = filterValues(mode);
  if (!values) return null;
  return (
    <filter id={filterId(mode)} color-interpolation-filters="linearRGB" x="-2%" y="-2%" width="104%" height="104%">
      <feColorMatrix type="matrix" values={values} />
    </filter>
  );
}

/** The `filter` attribute for the drawing, or undefined for normal colors. */
export function visionFilterAttr(): string | undefined {
  const mode = visionMode.value;
  return mode === "normal" ? undefined : `url(#${filterId(mode)})`;
}

/** Over the canvas while a view is on: what it shows, and a way back. */
export function VisionBadge() {
  const info = VISION_MODES.find((m) => m.mode === visionMode.value);
  if (!info || info.mode === "normal") return null;
  return (
    <div class="tf-vision-badge" role="status" data-testid="vision-badge">
      <span>
        The picture is shown {info.badge}. Your code and exports are unchanged.
      </span>
      <button onClick={() => (visionMode.value = "normal")} data-testid="vision-normal">
        Normal colors
      </button>
    </div>
  );
}
