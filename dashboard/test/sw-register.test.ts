// Spec 173, criteria 5 and 6: the few lines that register the service
// worker, and the guard that keeps them silent where there can be none.
//
// `sw-register.ts` can neither import nor export anything — `shell.ts`
// transpiles it into the same inline classic <script> the theme
// switcher rides in — so it cannot be imported the way every other
// module here is. It CAN be transpiled and run, which is what this file
// does, against a `navigator` small enough to state in full. The same
// shape `theme-script.test.ts` uses, for the same reason.
//
// The case that matters is the one with NO service worker at all: this
// script goes on every page the shell renders, including the generated
// ones, which are opened from a folder as often as from the server.
// There is no `navigator.serviceWorker` on a file:// origin, and a
// page that throws in <head> is a page that stops.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "src", "render", "sw-register.ts"), "utf-8"),
);

/** A browser with, or without, a service worker container. `refuses` is
 *  the plain-HTTP origin, which is where the dashboard still lives:
 *  `register` rejects there, and the answer records whether the script
 *  took the rejection or left it for the console. */
function run(opts: { supported?: boolean; refuses?: boolean } = {}) {
  const registered: string[] = [];
  let handled = false;

  // A thenable rather than a promise: it records the rejection handler
  // whichever way the script attaches one — `.catch`, `.then(a, b)` or
  // an `await` inside a try.
  const refusal = {
    then: (_ok: unknown, bad?: unknown) => {
      handled = handled || typeof bad === "function";
      return refusal;
    },
    catch: (bad?: unknown) => {
      handled = handled || typeof bad === "function";
      return refusal;
    },
  };

  const navigator =
    opts.supported === false
      ? {}
      : {
          serviceWorker: {
            register: (url: string): unknown => {
              registered.push(url);
              return opts.refuses ? refusal : Promise.resolve({ scope: "/" });
            },
          },
        };

  // eslint-disable-next-line no-new-func -- the file under test IS a script
  new Function("navigator", SOURCE)(navigator);
  return { registered, handled };
}

describe("registering the worker (criteria 5 and 6)", () => {
  test("it registers /sw.js, which is the scope the whole dashboard sits in", () => {
    expect(run().registered).toEqual(["/sw.js"]);
  });

  test("a browser with no service worker at all is left alone, not thrown at", () => {
    // The generated pages carry this script too, and are opened from a
    // folder. A ReferenceError in <head> would take the page with it.
    expect(() => run({ supported: false })).not.toThrow();
    expect(run({ supported: false }).registered).toEqual([]);
  });

  test("a refused registration is caught rather than left to the console", () => {
    // Plain HTTP is exactly this case, and it is where the dashboard
    // lives until the HTTPS work lands: `register` rejects, and an
    // unhandled rejection is noise on a page that is working fine.
    const { registered, handled } = run({ refuses: true });
    expect(registered).toEqual(["/sw.js"]);
    expect(handled).toBe(true);
  });
});
