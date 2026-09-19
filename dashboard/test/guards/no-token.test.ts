// The token is gone from the dashboard, and nothing names it any more: a
// mention that comes back is a route that starts asking for it again.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SCANNED = ["src", "docs", "Makefile", "deploy", join("test", "round")];

const FORBIDDEN: [string, RegExp][] = [
  ["queueToken", /queueToken/i],
  ["queue-token", /queue-token/i],
  ["token-file", /token-file/i],
  ["x-aide-token", /x-aide-token/i],
  ["aide_token", /aide_token/i],
  ["?token=", /[?&]token=/i],
  ['name="token"', /name="token"/i],
  ["tokenField", /tokenField/i],
  ["searchParams token", /searchParams\.(get|set|delete)\("token"/i],
  ["AIDE_ROUND_TOKEN", /AIDE_ROUND_TOKEN/i],
  ["aide-round-token", /aide-round-token/i],
  ["TOKEN_FILE", /TOKEN_FILE/i],
  ["$TOKEN", /\$TOKEN/i],
  ["queue token", /queue token/i],
];

function files(path: string): string[] {
  const s = statSync(path);
  if (!s.isDirectory()) return [path];
  return readdirSync(path).flatMap((n) => (n === "node_modules" ? [] : files(join(path, n))));
}

describe("nothing names the token (AC-4)", () => {
  const all = SCANNED.flatMap((p) => files(join(ROOT, p))).filter((f) => !f.endsWith(".png"));

  for (const [label, re] of FORBIDDEN) {
    test(`no file mentions ${label}`, () => {
      const hits = all.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length + 1));
      expect(hits).toEqual([]);
    });
  }
});
