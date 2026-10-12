// A plain page of the site (404): the look and the theme switch, nothing else.
import "../theme/theme.css";
import "./site.css";
import { bindThemeButton } from "../theme/theme.ts";

for (const b of document.querySelectorAll<HTMLElement>("[data-theme-switch]")) bindThemeButton(b);
