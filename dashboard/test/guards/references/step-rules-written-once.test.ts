// The step rules the runner owns are written once: the retry bound, the
// retry allowance, the ending of a step and the landing flag. A copy
// written by hand elsewhere drifts from the one the runner keeps.
import { expect, test } from "bun:test";
import { read } from "../source.ts";

const sources = read("src/**/*.ts");

const matching = (pattern: RegExp, except: string[] = []): string[] =>
  sources.filter(({ file, text }) => !except.includes(file) && pattern.test(text)).map(({ file }) => file);

test("no attempt count is compared with the bound written as a number (AC-4)", () => {
  expect(sources.length).toBeGreaterThan(200);
  expect(matching(/attempts?\s*(>=|===)\s*2\b/i, ["src/queue/runner/retry.ts"])).toEqual([]);
});

test("no store write names a step-ending event of its own (AC-5)", () => {
  const ending = /\.transition\(\s*[^,()]+,\s*["'](retry|run-stopped|step-failed|step-succeeded-last|step-succeeded|process-gone|cancel)["']/;
  expect(matching(ending)).toEqual([]);
});

test("no store write sets or clears the landing flag outside its helper (AC-6)", () => {
  const landingWrite = /\.(update|transition)\([^;]*?[{,]\s*landing\s*[:,}]/;
  expect(matching(landingWrite, ["src/queue/runner/landing.ts"])).toEqual([]);
});

test("the retry allowance is worked out in one function (AC-7)", () => {
  const allowance = /retry\?\.action\s*===[^?\n]*\?\s*[\w.?]*\.attempts\s*:\s*1\b/g;
  const found = sources.flatMap(({ file, text }) => [...text.matchAll(allowance)].map(() => file));
  expect(found).toEqual(["src/queue/runner/retry.ts"]);
});
