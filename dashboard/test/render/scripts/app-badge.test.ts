// The head script that puts the number of waiting specs on the app's icon.
//
// Like `sw-register.ts`, `app-badge.ts` can neither import nor export
// anything — `shell.ts` transpiles it into the one inline <script> — so it
// is transpiled and run here against a `navigator` and a `document` small
// enough to state in full.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "..", "..", "src", "render", "scripts", "app-badge.ts"), "utf-8"),
);

interface Opts {
  /** The `content` of the page's `aide-waiting` meta; absent: no meta. */
  meta?: string;
  /** A browser with, or without, the Badging API. */
  supported?: boolean;
  /** `setAppBadge` rejects, as an uninstalled tab's does. */
  refuses?: boolean;
}

/** A page with the script run on it, and the calls the browser saw. */
function run(opts: Opts = {}) {
  const calls: string[] = [];
  let handled = 0;
  const outcome = () => {
    if (!opts.refuses) return Promise.resolve();
    // A thenable that records whether the script took the rejection.
    const refusal = {
      then: (_ok: unknown, bad?: unknown) => {
        if (typeof bad === "function") handled += 1;
        return refusal;
      },
      catch: (bad?: unknown) => {
        if (typeof bad === "function") handled += 1;
        return refusal;
      },
    };
    return refusal;
  };
  const navigator =
    opts.supported === false
      ? {}
      : {
          setAppBadge: (n: number) => {
            calls.push(`set ${n}`);
            return outcome();
          },
          clearAppBadge: () => {
            calls.push("clear");
            return outcome();
          },
        };
  const listeners: Record<string, ((e: { detail: unknown }) => void)[]> = {};
  const document = {
    querySelector: (selector: string) =>
      selector.includes("aide-waiting") && opts.meta !== undefined ? { getAttribute: () => opts.meta, content: opts.meta } : null,
    addEventListener: (type: string, fn: (e: { detail: unknown }) => void) => {
      (listeners[type] ??= []).push(fn);
    },
  };
  // eslint-disable-next-line no-new-func -- the file under test IS a script
  new Function("navigator", "document", SOURCE)(navigator, document);
  const announce = (detail: unknown) => (listeners["aide:waiting"] ?? []).forEach((fn) => fn({ detail }));
  return { calls, announce, handled: () => handled };
}

describe("the page sets the count it loaded with", () => {
  test("a count above 0 is set once", () => {
    expect(run({ meta: "2" }).calls).toEqual(["set 2"]);
  });

  test("a count of 0 clears the icon and sets no number", () => {
    expect(run({ meta: "0" }).calls).toEqual(["clear"]);
  });

  test("a page with no count leaves the icon as it was", () => {
    expect(run().calls).toEqual([]);
    expect(run({ meta: "" }).calls).toEqual([]);
    expect(run({ meta: "many" }).calls).toEqual([]);
  });
});

describe("the page follows its live update", () => {
  test("a new number from the live client is set", () => {
    const page = run({ meta: "1" });
    page.announce(3);
    expect(page.calls).toEqual(["set 1", "set 3"]);
  });

  test("0 from the live client clears the icon rather than being dropped as false", () => {
    const page = run({ meta: "1" });
    page.announce(0);
    expect(page.calls).toEqual(["set 1", "clear"]);
  });

  test("a detail that is not a whole number is ignored", () => {
    const page = run({ meta: "1" });
    page.announce(undefined);
    page.announce("3");
    page.announce(-1);
    expect(page.calls).toEqual(["set 1"]);
  });
});

describe("a browser without the Badging API is left alone", () => {
  test("the script throws nothing and calls nothing, on load or on an update", () => {
    expect(() => run({ supported: false, meta: "2" })).not.toThrow();
    const page = run({ supported: false, meta: "2" });
    expect(() => page.announce(3)).not.toThrow();
    expect(page.calls).toEqual([]);
  });

  test("a refused badge is caught rather than left to the console", () => {
    const page = run({ meta: "2", refuses: true });
    page.announce(0);
    expect(page.calls).toEqual(["set 2", "clear"]);
    expect(page.handled()).toBe(2);
  });
});
