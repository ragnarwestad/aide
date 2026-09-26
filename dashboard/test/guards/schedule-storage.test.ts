// A scheduled job lives in the serving host's `queue-config.json`, not in a
// project's manifest and not in git. This repository's own manifest says
// so in data nothing else checks, so this is a plain regression guard.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dir, "..", "..");

test("this repository's .aide/project.yaml has no schedule key (AC-4)", () => {
  const manifest = parse(readFileSync(join(ROOT, "..", ".aide", "project.yaml"), "utf-8")) as Record<string, unknown>;
  expect(manifest).not.toHaveProperty("schedule");
});
