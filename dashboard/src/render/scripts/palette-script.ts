import { PAGE_DRAWN } from "../../page-contract.ts";
import { THEMES } from "../ui/css/themes.ts";

(() => {
  const KEY = "palette";
  const root = document.documentElement;
  const stored = (): string => {
    try { const value = localStorage.getItem(KEY); return (THEMES as readonly string[]).includes(value ?? "") ? value! : "default"; }
    catch { return "default"; }
  };
  const apply = (choice: string): void => {
    if (choice === "default") delete root.dataset.palette;
    else root.dataset.palette = choice;
  };
  const mark = (): void => document.querySelectorAll<HTMLInputElement>("[data-palette-choice]").forEach((radio) => {
    radio.checked = radio.value === stored();
  });
  apply(stored());
  document.addEventListener("change", (event) => {
    const radio = (event.target as Element | null)?.closest?.<HTMLInputElement>("[data-palette-choice]");
    if (!radio) return;
    try { localStorage.setItem(KEY, radio.value); } catch {}
    apply(radio.value); mark();
  });
  document.addEventListener("DOMContentLoaded", mark);
  document.addEventListener(PAGE_DRAWN, mark);
})();
