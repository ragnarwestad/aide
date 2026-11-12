import { esc } from "../../html.ts";
import { dataAttrs } from "../button.ts";

/** The header's icon trigger and its panel share presentation and menu behaviour. */
export function headerMenu(o: {
  label: string;
  icon: string;
  content: string;
  kind?: "theme" | "lang" | "unit";
  id?: string;
  data?: Record<string, string>;
  panelClass?: string;
}): string {
  return `<details class="menu${o.kind ? ` ${o.kind}` : ""}"${o.id ? ` id="${esc(o.id)}"` : ""}${dataAttrs(o.data)}>` +
    `<summary aria-label="${esc(o.label)}" title="${esc(o.label)}">${o.icon}</summary>` +
    `<div class="menupanel${o.panelClass ? ` ${esc(o.panelClass)}` : ""}">${o.content}</div></details>`;
}
