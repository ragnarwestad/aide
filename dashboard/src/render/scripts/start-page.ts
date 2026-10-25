// Where the board starts: the first board page a browser tab or an
// installed app's window loads. A page that is a start, and whose head
// names a page to start on instead (`<meta name="aide-start">`, written by
// the Running tab when it has no row), replaces itself with that page.
// Every page marks the tab as started first, so a click, a link and a
// reload later in the same tab show what was asked for.
//
// Like `app-badge.ts`, it can neither import nor export anything —
// `shell.ts` transpiles it into the one inline <script> — and it shares
// that tag with every other head script, so nothing here may throw: a tab
// without storage shows the page it asked for.

(() => {
  let started: boolean;
  try {
    started = sessionStorage.getItem("aide-started") === "1";
    sessionStorage.setItem("aide-started", "1");
  } catch {
    return;
  }
  if (started) return;
  const to = document.querySelector('meta[name="aide-start"]')?.getAttribute("content") ?? "";
  if (to) location.replace(to);
})();
