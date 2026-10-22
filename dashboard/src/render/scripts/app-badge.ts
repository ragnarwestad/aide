// The number on the installed app's icon: how many specs wait for a person.
//
// Like `sw-register.ts`, this file can neither import nor export anything —
// `shell.ts` transpiles it into the same inline classic <script> — and
// `test/render/scripts/app-badge.test.ts` runs it against a fake navigator
// and document for the same reason.
//
// The server writes the count into a <meta> before this script, so the badge
// is set before the body is drawn. A page that holds the live connection
// hears the new number as an `aide:waiting` event on the document, sent by
// the specs client; the two cannot share a function, so the event is the seam.
//
// A browser without the Badging API is left alone: the generated pages carry
// this script too, and most browsers have no badge to set. A browser that
// refuses the call (a tab that is not an installed app) logs nothing.

(() => {
  if (typeof navigator.setAppBadge !== "function") return;

  const show = (n: unknown): void => {
    // 0 is a number to clear the icon with, not an absence to skip.
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return;
    try {
      const done = n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge();
      if (done && typeof done.catch === "function") done.catch(() => {});
    } catch {
      // A badge that cannot be set changes nothing else on the page.
    }
  };

  const raw = document.querySelector('meta[name="aide-waiting"]')?.getAttribute("content") ?? "";
  if (/^\d+$/.test(raw)) show(Number(raw));

  document.addEventListener("aide:waiting", (e) => show((e as CustomEvent).detail));
})();
