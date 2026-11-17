import { expect, test } from "bun:test";
import { slowTests } from "../../scripts/test-timings.ts";

test("ranks cases from different workers using each case's owning file", () => {
  expect(slowTests([
    "test/a.test.ts:\n(pass) fast [3.20ms]\n(pass) slow [1500.50ms]\n",
    "test/b.test.ts:\n(fail) medium [100.00ms]\n",
  ], 2)).toEqual([
    { file: "test/a.test.ts", name: "slow", milliseconds: 1500.5 },
    { file: "test/b.test.ts", name: "medium", milliseconds: 100 },
  ]);
});

test("ignores summaries, untimed cases and unowned output", () => {
  expect(slowTests(["(pass) unowned [9ms]\nnoise\ntest/a.test.ts:\n(skip) skipped\nRan 3 tests across 1 file. [42ms]\n"])).toEqual([]);
});

test("keeps ANSI output readable without confusing a repeated failure summary for another run", () => {
  expect(slowTests(["test/a.test.ts:\n\u001b[31m(fail) rule [120.00ms]\u001b[0m\n(fail) rule [120.00ms]\n"])).toEqual([
    { file: "test/a.test.ts", name: "rule", milliseconds: 120 },
  ]);
});

test("a repeated failure summary keeps the original file", () => {
  expect(slowTests(["test/a.test.ts:\n(fail) rule [120ms]\ntest/b.test.ts:\n(pass) other [2ms]\n(fail) rule [120ms]\n"]))
    .toEqual([
      { file: "test/a.test.ts", name: "rule", milliseconds: 120 },
      { file: "test/b.test.ts", name: "other", milliseconds: 2 },
    ]);
});
