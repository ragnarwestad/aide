// The board needs its page script, and keeps no second way for a browser
// that runs none: no message rides the address, no page reloads itself
// by a meta refresh, and no head script posts or marks a form.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function files(path: string): string[] {
  const s = statSync(path);
  if (!s.isDirectory()) return path.endsWith(".ts") ? [path] : [];
  return readdirSync(path).flatMap((n) => files(join(path, n)));
}

const hits = (dirs: string[], re: RegExp): string[] =>
  dirs
    .flatMap((d) => files(join(ROOT, d)))
    .filter((f) => re.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));

const MESSAGES = "error|errorSpec|notice|noticeOk|deployError|wikiError";

describe("no message rides the address", () => {
  test("no address is built carrying a message (AC-1)", () => {
    const literal = new RegExp(`[?&"'\`](?:${MESSAGES})=`);
    const set = new RegExp(`\\.set\\(\\s*["'](?:${MESSAGES})["']`);
    expect(hits(["src/serve", "src/specs-client"], literal)).toEqual([]);
    expect(hits(["src/serve", "src/specs-client"], set)).toEqual([]);
  });

  // A page reads its address only as `searchParams.get("<name>")`, so a
  // scan for the names is a scan of every read: a read by a key held in a
  // variable, a walk over every parameter or a second parse of the query
  // would slip past it, and is refused on its own.
  test("no page reads a message from its address (AC-2)", () => {
    const named = new RegExp(`\\.get\\(\\s*["'\`](?:${MESSAGES})["'\`]\\s*\\)`);
    expect(hits(["src/serve", "src/render"], named)).toEqual([]);
    expect(hits(["src/render"], new RegExp(`[?&"'\`](?:${MESSAGES})=`))).toEqual([]);
    expect(hits(["src/serve", "src/render"], /searchParams(?!\.get\(\s*["'`][\w.-]+["'`]\s*\))/)).toEqual([]);
    // The form-body parser is the one other reader of an encoded query.
    expect(hits(["src/serve", "src/render"], /URLSearchParams\(/)).toEqual(["src/serve/serve-helpers/http.ts"]);
  });
});

describe("no page reloads itself by a meta refresh", () => {
  test("no source writes http-equiv=\"refresh\" (AC-5)", () => {
    expect(hits(["src"], /http-equiv=\\?["']?refresh/i)).toEqual([]);
  });
});

describe("a form's submit is the page script's alone", () => {
  test("no head script the shell inlines listens for submit, but the unsaved-changes guard (AC-4)", () => {
    const shell = join(ROOT, "src", "render", "ui", "shell.ts");
    const inlined = [...readFileSync(shell, "utf8").matchAll(/transpile\("([^"]+)"\)/g)].map((m) =>
      join(dirname(shell), m[1]!),
    );
    expect(inlined.length).toBeGreaterThan(0);
    const listening = inlined
      .filter((f) => /addEventListener\(\s*["']submit["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    expect(listening).toEqual(["src/render/ui/forms/unsaved-changes.ts"]);
  });
});
