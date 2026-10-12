// The theme switch (D91, D92): system, light or dark, kept per viewer in localStorage. public/boot.js
// applies the choice before the first paint; this module changes it and keeps the switch's label true.

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "tikzflow.theme";
const ORDER: ThemeChoice[] = ["system", "light", "dark"];

export function themeChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** The theme in effect: the choice, or the system's. */
export function effectiveTheme(choice = themeChoice()): "light" | "dark" {
  if (choice !== "system") return choice;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage refused: the choice lasts for this page only.
  }
  document.documentElement.dataset.theme = effectiveTheme(choice);
}

/** The next choice in the switch's cycle: system, light, dark. */
export const nextTheme = (c: ThemeChoice): ThemeChoice => ORDER[(ORDER.indexOf(c) + 1) % ORDER.length]!;

export const themeLabel = (c: ThemeChoice): string => `Theme: ${c === "system" ? "same as system" : c}. Click for ${nextTheme(c) === "system" ? "same as system" : nextTheme(c)}.`;

const ICONS: Record<ThemeChoice, string> = {
  system: '<path d="M12 21a9 9 0 1 0 0-18v18Z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9" fill="none"/>',
  light: '<circle cx="12" cy="12" r="4" fill="none"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none"/>',
};
export const themeIcon = (c: ThemeChoice): string => ICONS[c];

/** Wires a plain button (the static pages') to cycle the theme. */
export function bindThemeButton(button: HTMLElement): void {
  const show = () => {
    const c = themeChoice();
    button.setAttribute("aria-label", themeLabel(c));
    button.title = themeLabel(c);
    const svg = button.querySelector("svg");
    if (svg) svg.innerHTML = themeIcon(c);
  };
  button.addEventListener("click", () => {
    setThemeChoice(nextTheme(themeChoice()));
    show();
  });
  window.addEventListener("storage", show);
  show();
}
