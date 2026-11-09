import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDER_TOOLS, TOOLS } from "../../../src/queue/providers/tools.ts";
import { TOOL_READERS } from "../../../src/serve/tool-readers/index.ts";

describe("the readers named by each tool descriptor", () => {
  test("every provider tool resolves login, models and usage through the registry (AC-5)", () => {
    expect(Object.keys(TOOL_READERS)).toEqual([...PROVIDER_TOOLS]);
    for (const tool of PROVIDER_TOOLS) {
      expect(TOOLS[tool].readers as Record<string, string>).toEqual({ transcript: tool, login: tool, models: tool, usage: tool });
      expect(Object.keys(TOOL_READERS[tool])).toEqual(["login", "models", "usage"]);
    }
  });

  test("the public readers contain no second per-tool dispatch (AC-5)", () => {
    for (const relative of ["tool-check.ts", "tool-models/index.ts", "tool-usage/index.ts"]) {
      const source = readFileSync(join(import.meta.dir, `../../../src/serve/${relative}`), "utf8");
      expect(source).not.toMatch(/switch\s*\(tool\)|tool\s*===\s*["'](?:claude|codex|opencode)["']/);
    }
  });

  test("a provider tool missing from the registry is a type error (AC-5)", () => {
    // @ts-expect-error opencode is missing
    const missing = { claude: TOOL_READERS.claude, codex: TOOL_READERS.codex } satisfies typeof TOOL_READERS;
    expect(Object.keys(missing)).toHaveLength(2);
  });
});
