// While the page says a Deploy is waiting for landings in flight before it
// restarts the service, ask `/api/version` every few seconds and load
// the page again once another process answers: the notice was drawn by
// the process that is about to go, and nothing else would take it down.
//
// Like the other head scripts, this file can neither import nor export
// anything. `test/render/scripts/restart-watch.test.ts` runs it against
// a fake document, fetch and timer.

(() => {
  const EVERY_MS = 5000;
  const watch = (): void => {
    const notice = document.querySelector("[data-started-at]");
    const drawnBy = notice?.getAttribute("data-started-at");
    if (!drawnBy) return;
    const ask = async (): Promise<void> => {
      try {
        const res = await fetch("/api/version", { headers: { accept: "application/json" } });
        const answer = (await res.json()) as { startedAt?: string | null };
        if (answer.startedAt && answer.startedAt !== drawnBy) {
          location.reload();
          return;
        }
      } catch {
        // Down between the old process and the new one: ask again.
      }
      setTimeout(ask, EVERY_MS);
    };
    setTimeout(ask, EVERY_MS);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
  else watch();
})();
