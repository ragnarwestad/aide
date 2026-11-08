// The tool lists and the name maps are written once, in `queue/providers/tools.ts`.
// The type checker holds a map to its list (`make test` runs `tsc --noEmit` over this
// folder); the scans below hold the source to naming a set of tools nowhere else.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDER_TOOLS as providersExport } from "../../../src/queue/providers/index.ts";
import {
  PROVIDER_TOOLS,
  RESULT_TOOLS,
  RUNNABLE_TOOLS,
  SHORT_TOOL_NAMES,
  TOOL_NAMES,
} from "../../../src/queue/providers/tools.ts";
import {
  RUNNABLE_TOOLS as stepsExport,
  asResultTool,
} from "../../../src/queue/steps.ts";
import {
  SHORT_TOOL_NAMES as pickerShort,
  TOOL_NAMES as pickerNames,
} from "../../../src/render/pages/specs-list/model-resolve.ts";

const SRC = join(import.meta.dir, "../../../src");
const T = "(claude|codex|opencode|fake-claude|none)";

/** Every code line of every .ts file under src, as `file:line: text`, comments left out. */
function codeLines(dir: string = SRC): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...codeLines(path));
    else if (entry.name.endsWith(".ts")) {
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((text, i) => {
          if (!/^\s*(\/\/|\*|\/\*)/.test(text))
            out.push({ where: `${path.slice(SRC.length + 1)}:${i + 1}`, text });
        });
    }
  }
  return out;
}

describe("the tool lists", () => {
  test("the modules that used to define a list hand out the same array (AC-1)", () => {
    expect(providersExport).toBe(PROVIDER_TOOLS);
    expect(stepsExport).toBe(RUNNABLE_TOOLS);
    expect(pickerNames).toBe(TOOL_NAMES);
    expect(pickerShort).toBe(SHORT_TOOL_NAMES);
  });

  test("each wider list is the narrower one and what it adds (AC-1)", () => {
    expect([...RUNNABLE_TOOLS]).toEqual([...PROVIDER_TOOLS, "fake-claude"]);
    expect([...RESULT_TOOLS]).toEqual([...RUNNABLE_TOOLS, "none"]);
  });

  test("a result's tool is any of the list and nothing else (AC-1)", () => {
    for (const tool of RESULT_TOOLS) expect(asResultTool(tool)).toBe(tool);
    expect(asResultTool("gemini")).toBeUndefined();
    expect(asResultTool(undefined)).toBeUndefined();
  });

  test("no array of tool names is written out but the provider tools and the removed Settings tabs (AC-1)", () => {
    const pair = new RegExp(`"${T}",\\s*"${T}"`);
    const hits = codeLines()
      .filter((l) => pair.test(l.text))
      .map((l) => l.where.split(":")[0]);
    expect(hits.sort()).toEqual([
      "queue/providers/tools.ts",
      "render/pages/settings-page/index.ts",
    ]);
  });

  test("no union of tool names is written out, nor a tool type widened by one (AC-2)", () => {
    const union = new RegExp(
      `"${T}"\\s*\\|\\s*"${T}"|[A-Za-z]Tool\\s*\\|\\s*"${T}"`,
    );
    expect(
      codeLines()
        .filter((l) => union.test(l.text))
        .map((l) => l.where),
    ).toEqual([]);
  });
});

describe("the name maps are keyed by the tool type", () => {
  test("a runnable tool left out of TOOL_NAMES is a type error (AC-3)", () => {
    // @ts-expect-error opencode and fake-claude are missing
    const missing = { claude: "x", codex: "x" } satisfies typeof TOOL_NAMES;
    expect(Object.keys(missing)).toHaveLength(2);
  });

  test("a runnable tool left out of SHORT_TOOL_NAMES is a type error (AC-3)", () => {
    // @ts-expect-error opencode and fake-claude are missing
    const missing = { claude: "x", codex: "x" } satisfies typeof SHORT_TOOL_NAMES;
    expect(Object.keys(missing)).toHaveLength(2);
  });

  test("both maps name every runnable tool, in the list's order (AC-5)", () => {
    expect(Object.keys(TOOL_NAMES)).toEqual([...RUNNABLE_TOOLS]);
    expect(Object.keys(SHORT_TOOL_NAMES)).toEqual([...RUNNABLE_TOOLS]);
  });
});
