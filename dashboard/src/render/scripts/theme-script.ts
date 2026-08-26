// The reader's theme choice, applied before the page paints.
//
// The one script every page carries — served and generated alike. That
// is a deliberate exception to "the generated pages carry no page
// code", and it is this narrow for a reason: a generated page is a
// FILE, opened from a folder as often as from the server, so nothing
// upstream of the browser can have decided what colour it should be.
// Reading the choice and setting one attribute is the whole of it.
//
// Like `queue-client.ts`, this file can neither import nor export
// anything: `shell.ts` transpiles it into an inline classic <script>.
// `test/theme-script.test.ts` runs it against a fake document for the
// same reason that file exists.
//
// It runs in <head>, which is the opposite of where `opts.script` goes
// and for the opposite reason: the theme must be on the html element
// BEFORE the body is parsed, or the reader sees the wrong one first.
// The half that needs elements waits for DOMContentLoaded.

(() => {
  const KEY = "theme";
  const root = document.documentElement;

  /** The remembered choice, or "auto" for anything else — missing,
   *  "auto" itself, or a value nobody here wrote. Storage can throw
   *  outright (private browsing, a file:// origin some browsers refuse
   *  storage to), and a page that cannot remember is still a page that
   *  has to render. */
  function stored(): string {
    try {
      const value = localStorage.getItem(KEY);
      return value === "dark" || value === "light" ? value : "auto";
    } catch {
      return "auto";
    }
  }

  /** Auto sets NOTHING: with no attribute the page falls through to
   *  `prefers-color-scheme` exactly as it did before this file existed. */
  function apply(choice: string): void {
    if (choice === "dark" || choice === "light") root.dataset.theme = choice;
    else delete root.dataset.theme;
  }

  function mark(buttons: NodeListOf<Element>, choice: string): void {
    buttons.forEach((button) => {
      if (button.getAttribute("data-theme-choice") === choice) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    });
  }

  /** The header trigger's own icon, one of three spans already in the
   *  DOM (spec 243) rather than markup swapped in — `hidden` is a plain
   *  attribute the browser already knows how to act on, so there is
   *  nothing here to undo if this script never runs. */
  function markIcon(icons: NodeListOf<Element>, choice: string): void {
    icons.forEach((icon) => {
      if (icon.getAttribute("data-theme-icon") === choice) icon.removeAttribute("hidden");
      else icon.setAttribute("hidden", "");
    });
  }

  apply(stored());

  document.addEventListener("DOMContentLoaded", () => {
    const buttons = document.querySelectorAll("[data-theme-choice]");
    const icons = document.querySelectorAll("[data-theme-icon]");
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const choice = button.getAttribute("data-theme-choice") ?? "auto";
        try {
          localStorage.setItem(KEY, choice);
        } catch {
          // No memory here, but the switch still works for as long as
          // this page is open — better than refusing to switch at all.
        }
        // No reload: the tokens are on :root, so changing the attribute
        // re-themes everything already on screen.
        apply(choice);
        mark(buttons, choice);
        markIcon(icons, choice);
      });
    });
    // The server marked Auto, because it had no way to know. Now we do.
    mark(buttons, stored());
    markIcon(icons, stored());
  });
})();
