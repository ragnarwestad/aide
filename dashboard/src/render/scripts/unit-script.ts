// The unit the reader wants consumption in, applied before the page
// paints.
//
// `theme-script.ts`'s sibling, and deliberately a separate file rather
// than a second concern folded into it: a unit is not a colour, and the
// file next door was written narrow on purpose. The two are transpiled
// into the SAME inline <script> by `shell.ts` — the page still carries
// exactly one — so this costs a file, not a script tag.
//
// Why it exists at all: on a subscription plan the dollar figure is
// notional and the token count is what the plan meters. Which of the two
// a reader wants is a preference, not a page, so it is remembered in the
// browser and switches with no reload.
//
// Like `specs-client.ts`, this file can neither import nor export
// anything.

(() => {
  const KEY = "unit";
  const root = document.documentElement;

  /** The remembered choice, or "usd" for anything else — missing, "usd"
   *  itself, or a value nobody here wrote. Storage can throw outright
   *  (private browsing, a file:// origin some browsers refuse storage
   *  to), and a page that cannot remember is still a page that has to
   *  render a number. */
  function stored(): string {
    try {
      return localStorage.getItem(KEY) === "tokens" ? "tokens" : "usd";
    } catch {
      return "usd";
    }
  }

  /** Dollars set NOTHING: with no attribute the page shows exactly what
   *  it showed before this file existed. Only the token choice is
   *  written down, and one CSS rule each hides the other span. */
  function apply(choice: string): void {
    if (choice === "tokens") root.dataset.unit = "tokens";
    else delete root.dataset.unit;
  }

  function mark(radios: NodeListOf<Element>, choice: string): void {
    radios.forEach((radio) => {
      (radio as HTMLInputElement).checked = radio.getAttribute("data-unit-choice") === choice;
    });
  }

  apply(stored());

  const markPage = (): void => {
    const radios = document.querySelectorAll("[data-unit-choice]");
    mark(radios, stored());
  };
  document.addEventListener("change", (event) => {
    const radio = (event.target as Element | null)?.closest?.("[data-unit-choice]");
    if (!radio) return;
    const choice = radio.getAttribute("data-unit-choice") ?? "usd";
    try { localStorage.setItem(KEY, choice); } catch {}
    apply(choice);
    markPage();
  });
  document.addEventListener("DOMContentLoaded", markPage);
  document.addEventListener("aide-page-drawn", markPage);
})();
