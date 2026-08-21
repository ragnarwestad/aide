// Registering the service worker: the last of the four scripts every
// page carries, and the smallest.
//
// Like `theme-script.ts`, this file can neither import nor export
// anything — `shell.ts` transpiles it into the same inline classic
// <script> — and `test/sw-register.test.ts` runs it against a fake
// navigator for the same reason that file exists.
//
// Both guards below are the ordinary case, not the edge one. Every
// page the shell renders carries this, the generated ones included,
// and those are opened from a folder as often as from the server:
// there is no `navigator.serviceWorker` on a file:// origin, and a
// script that throws in <head> takes the page with it. Plain HTTP is
// the other half — the address the dashboard answers on today — where
// the container exists and registration is refused, and an unhandled
// rejection is noise on a page that is working perfectly well.

(() => {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Nothing to do and nothing to say: without a secure context there
    // is no worker, and the dashboard reads exactly as it always has.
  });
})();
