// The toolbar's icons (D92): drawn for TikZFlow on a 24-unit grid, stroked with the text color.
import type { JSX } from "preact";

const PATHS = {
  open: "M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9.5A1.5 1.5 0 0 0 19.5 8H12l-2-2.5H4.5A1.5 1.5 0 0 0 3 7Z",
  save: "M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4ZM8 4v5h7V4M8 20v-6h8v6",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14",
  file: "M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V3.5ZM14 3.5V8h4",
  undo: "M9 7 4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12",
  redo: "M15 7l4.5 4.5L15 16M19 11.5H9.5a5 5 0 0 0 0 10H12",
  layout: "M10 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4zM12 8v4M6 16v-4h12v4",
  page: "M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V3.5ZM14 3.5V8h4M9 12h6M9 15.5h6",
  import: "M12 3.5v10M8 9.5l4 4 4-4M4.5 14v5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5",
  export: "M12 14V3.5M8 7.5l4-4 4 4M4.5 14v5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5",
  share: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  restore: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg class="tf-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The logo (D91): two nodes joined by a `|-` corner. Colors follow the theme. */
export function Logo({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg class="tf-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="13" height="10" rx="2" fill="var(--logo-ink)" />
      <path d="M9.5 13V24H12.5" fill="none" stroke="var(--logo-ink)" stroke-width="2.4" />
      <path d="M11.5 20.3L16.2 24L11.5 27.7Z" fill="var(--logo-ink)" />
      <rect x="17.2" y="19.2" width="11.6" height="9.6" rx="2" fill="none" stroke="var(--logo-accent)" stroke-width="2.4" />
    </svg>
  );
}
