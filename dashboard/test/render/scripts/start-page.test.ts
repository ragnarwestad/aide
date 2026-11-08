// The head script that moves a browser tab's first board page to the page
// its head names.
//
// Like `app-badge.ts`, `start-page.ts` can neither import nor export
// anything — `shell.ts` transpiles it into the one inline <script> — so it
// is transpiled and run here against a `sessionStorage`, a `document` and a
// `location` small enough to state in full.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "..", "..", "src", "render", "scripts", "start-page.ts"), "utf-8"),
);

interface Opts {
  /** The `content` of the page's `aide-start` meta; absent: no meta. */
  meta?: string;
  /** The tab already carries the started mark. */
  started?: boolean;
  /** Reading or writing `sessionStorage` throws. */
  storageThrows?: boolean;
}

/** A page with the script run on it: what it replaced the page with, and what it stored. */
function run(opts: Opts = {}) {
  const replaced: string[] = [];
  const stored = new Map<string, string>();
  if (opts.started) stored.set("aide-started", "1");
  const sessionStorage = {
    getItem: (key: string) => {
      if (opts.storageThrows) throw new Error("storage is blocked");
      return stored.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (opts.storageThrows) throw new Error("storage is blocked");
      stored.set(key, value);
    },
  };
  const document = {
    querySelector: (selector: string) =>
      selector.includes("aide-start") && opts.meta !== undefined ? { getAttribute: () => opts.meta } : null,
  };
  const location = { replace: (to: string) => replaced.push(to) };
  new Function("sessionStorage", "document", "location", SOURCE)(sessionStorage, document, location);
  return { replaced, stored };
}

describe("start-page.ts", () => {
  test("a tab's first page that names a page to start on is replaced by it, once, and marks the tab", () => {
    const { replaced, stored } = run({ meta: "/specs" });
    expect(replaced).toEqual(["/specs"]);
    expect(stored.get("aide-started")).toBe("1");
  });

  test("a tab's first page with no such meta stays, and marks the tab", () => {
    const { replaced, stored } = run();
    expect(replaced).toEqual([]);
    expect(stored.get("aide-started")).toBe("1");
  });

  test("a page in a tab that has shown a board page stays, whatever its head names", () => {
    expect(run({ meta: "/specs", started: true }).replaced).toEqual([]);
  });

  test("a tab whose storage throws throws nothing and keeps the page", () => {
    expect(run({ meta: "/specs", storageThrows: true }).replaced).toEqual([]);
  });
});
