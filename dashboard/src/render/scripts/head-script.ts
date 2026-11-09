import { join } from "node:path";

const built = await Bun.build({
  entrypoints: [join(import.meta.dir, "index.ts")],
  target: "browser",
  format: "iife",
});

if (!built.success) throw new AggregateError(built.logs, "render/scripts/index.ts failed to bundle");

export const HEAD_SCRIPT = await built.outputs[0]!.text();
