// The unit the reader wants consumption in, applied before the page
// paints.
//
// `theme-script.ts`'s sibling, and deliberately a separate file rather
// than a second concern folded into it: a unit is not a colour, and the
// file next door was written narrow on purpose. The two are transpiled
// into the SAME inline <script> by `shell.ts` — the page still carries
// exactly one, which is the promise a guard test holds it to — so this
// costs a file, not a script tag.
//
// Why it exists at all: on a subscription plan the dollar figure is
// notional and the token count is what the plan meters. Which of the two
// a reader wants is a preference, not a page, so it is remembered in the
// browser and switches with no reload.
//
// Like `queue-client.ts`, this file can neither import nor export
// anything. `test/unit-script.test.ts` runs it against a fake document
// for the same reason that file exists.

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

  document.addEventListener("DOMContentLoaded", () => {
    const radios = document.querySelectorAll("[data-unit-choice]");
    radios.forEach((radio) => {
      radio.addEventListener("change", () => {
        const choice = radio.getAttribute("data-unit-choice") ?? "usd";
        try {
          localStorage.setItem(KEY, choice);
        } catch {
          // No memory here, but the switch still works for as long as
          // this page is open — better than refusing to switch at all.
        }
        // No reload: both figures are already in the page, and the
        // attribute decides which one is shown.
        apply(choice);
        mark(radios, choice);
      });
    });
    // The server marked $, because it had no way to know. Now we do.
    mark(radios, stored());
  });
})();
