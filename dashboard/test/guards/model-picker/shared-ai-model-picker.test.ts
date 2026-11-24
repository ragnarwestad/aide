import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const AI_MODEL = "src/render/ui/ai-model";

/** Every module path a source file imports or re-exports from. */
function importsOf(file: string): string[] {
  const source = readFileSync(join(root, file), "utf8");
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/g)].map((m) => m[1]!);
}

function sharedModuleFiles(): string[] {
  const dir = join(root, AI_MODEL);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => `${AI_MODEL}/${f}`);
}

test("all picker pages use the shared select renderers (AC-4, AC-11)", () => {
  for (const file of [
    "src/render/pages/specs-list/model-picker/index.ts",
    "src/render/pages/settings-page/index.ts",
    "src/render/pages/schedule-page/form.ts",
  ]) {
    expect(readFileSync(join(root, file), "utf8")).toContain("providerSelect");
    expect(readFileSync(join(root, file), "utf8")).toContain("modelSelect");
  }
  const options = readFileSync(join(root, "src/render/pages/new-spec-page/options.ts"), "utf8");
  expect(options).not.toContain("newSpecPhaseTable");
  expect(options).not.toContain("phaseChoiceTable");
});

test("the shared AI/model controls import nothing from the pages (AC-1)", () => {
  const files = sharedModuleFiles();
  expect(files).toContain(`${AI_MODEL}/index.ts`);
  expect(files).toContain(`${AI_MODEL}/options.ts`);
  for (const file of files) {
    expect({ file, pages: importsOf(file).filter((p) => p.includes("/pages/") || p.startsWith("../pages")) }).toEqual({ file, pages: [] });
  }
});

test("the pages outside the specs list take the controls from the shared module (AC-1)", () => {
  for (const file of [
    "src/render/pages/schedule-page/form.ts",
    "src/render/pages/settings-page/index.ts",
    "src/render/pages/projects-page/project-models.ts",
    "src/serve/providers/options.ts",
  ]) {
    const imports = importsOf(file);
    expect({ file, specsList: imports.filter((p) => p.includes("specs-list")) }).toEqual({ file, specsList: [] });
    expect({ file, shared: imports.some((p) => p.endsWith("ui/ai-model") || p.includes("ui/ai-model/")) }).toEqual({ file, shared: true });
  }
});

test("the model controls and their options do not import each other (AC-2)", () => {
  expect(existsSync(join(root, `${AI_MODEL}/options.ts`))).toBe(true);
  expect(importsOf(`${AI_MODEL}/options.ts`).filter((p) => p.startsWith("./"))).toEqual([]);
  for (const file of sharedModuleFiles()) {
    expect({ file, picker: importsOf(file).filter((p) => p.includes("model-picker")) }).toEqual({ file, picker: [] });
  }
});

test("Settings and the provider settings route take the tool names from their own module (AC-4)", () => {
  for (const file of [
    "src/render/pages/settings-page/index.ts",
    "src/render/pages/settings-page/providers.ts",
    "src/render/pages/settings-page/provider-add.ts",
    "src/render/pages/settings-page/provider-detail.ts",
    "src/serve/routes/providers/settings.ts",
  ]) {
    const source = readFileSync(join(root, file), "utf8");
    const imports = importsOf(file);
    expect({ file, specsList: imports.filter((p) => p.includes("specs-list")) }).toEqual({ file, specsList: [] });
    if (source.includes("TOOL_NAMES")) {
      const line = source.split("\n").find((l) => /\bimport\b.*\bTOOL_NAMES\b/.test(l)) ?? "";
      expect({ file, line: line.includes("queue/providers/tools.ts") }).toEqual({ file, line: true });
    }
  }
});
