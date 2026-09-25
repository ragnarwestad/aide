// Every temp directory a test makes, and every one a script it starts
// makes (they inherit TMPDIR), goes inside this process's own, removed
// when the process exits. Left in the machine's shared temp directory
// they are never removed, and a directory of millions of entries takes
// minutes to read for every program that reaches for temp. Loaded for
// every `bun test`, so a single file run by hand is covered as well as
// the full suite.
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const own = mkdtempSync(join(tmpdir(), "aide-bun-test-"));
process.env.TMPDIR = own;
// A hook registered here runs once, after the last test of the process;
// `bun test` exits without firing process "exit" listeners.
afterAll(() => rmSync(own, { recursive: true, force: true }));
