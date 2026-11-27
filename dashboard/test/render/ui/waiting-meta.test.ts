// Every page loads with the count of specs that wait for a person, in the
// <meta> the app's icon script reads.
import { afterEach, expect, test } from "bun:test";
import { setWaitingCount } from "../../../src/render/ui/pwa.ts";
import { shellHead } from "../../../src/render/ui/shell.ts";

afterEach(() => setWaitingCount(null));

test("a page's head carries the board's waiting count", () => {
  setWaitingCount(() => 1);
  expect(shellHead("Jobs")).toContain('<meta name="aide-waiting" content="1">');
});

test("a count of 0 is carried, not dropped", () => {
  setWaitingCount(() => 0);
  expect(shellHead("Jobs")).toContain('<meta name="aide-waiting" content="0">');
});

test("with no count known the head carries no count", () => {
  setWaitingCount(null);
  expect(shellHead("Jobs")).not.toContain('<meta name="aide-waiting"');
});
