import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAideConfig, writeAideConfig } from "../../src/project/aide-config.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

test("the first exact config key wins, including an empty value (AC-2)", () => {
  const root = mkdtempSync(join(tmpdir(), "aide-config-"));
  dirs.push(root);
  mkdirSync(join(root, ".aide"));
  writeFileSync(join(root, ".aide", "config"), " KEY=ignored\nKEY=   \nKEY=later\nEQUAL=a=b\n");
  expect(readAideConfig(root, "KEY")).toBeNull();
  expect(readAideConfig(root, "EQUAL")).toBe("a=b");
});

test("one config writer preserves unrelated lines and normalizes every named key (AC-3)", () => {
  const root = mkdtempSync(join(tmpdir(), "aide-config-"));
  dirs.push(root);
  mkdirSync(join(root, ".aide"));
  writeFileSync(join(root, ".aide", "config"), "# keep\nKEY=old\nOTHER=yes\nKEY=duplicate\n");
  writeAideConfig(root, { KEY: "new" });
  expect(readFileSync(join(root, ".aide", "config"), "utf8")).toBe("# keep\nOTHER=yes\nKEY=new\n");
});
