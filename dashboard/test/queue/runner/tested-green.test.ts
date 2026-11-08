// `testedGreen` comes from another process's JSON, and a landing skips a
// whole suite on its word — so anything short of a real tree hash and a
// list of command strings is dropped, never half-read.

import { describe, expect, test } from "bun:test";
import { testedGreen } from "../../../src/queue/runner/types.ts";

const TREE = "4c06462edc4b82534d3a6dc5a54782ae597c2259";

describe("reading what a step saw green", () => {
  test("a tree hash and its commands are read as they are", () => {
    expect(testedGreen({ tree: TREE, commands: ["make test"] })).toEqual({ tree: TREE, commands: ["make test"] });
  });

  test.each([
    ["absent", undefined],
    ["a tree that is no hash", { tree: "HEAD", commands: ["make test"] }],
    ["no commands", { tree: TREE, commands: [] }],
    ["a command that is not a string", { tree: TREE, commands: [42] }],
  ])("%s is dropped whole", (_label, raw) => {
    expect(testedGreen(raw)).toBeUndefined();
  });
});
