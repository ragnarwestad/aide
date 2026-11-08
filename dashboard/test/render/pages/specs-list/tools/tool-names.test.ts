// The tools a step can run with: aide-run-spec refuses any other `--tool`,
// and the dashboard names each one. A tool added on one side only is either
// refused by the runner or shown without a name.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SHORT_TOOL_NAMES,
  TOOL_NAMES,
} from "../../../../../src/render/pages/specs-list/model-resolve.ts";

const ARGUMENTS = join(
  import.meta.dir,
  "../../../../../../core/scripts/lib/run-spec/setup/arguments.sh",
);

test("the dashboard names every tool aide-run-spec accepts, and no other", () => {
  const accepted = /case "\$tool" in\n\s*([a-z|-]+)\) ;;/
    .exec(readFileSync(ARGUMENTS, "utf-8"))?.[1]
    ?.split("|");
  expect(accepted?.length).toBeGreaterThan(0);
  expect(Object.keys(TOOL_NAMES).sort()).toEqual([...accepted!].sort());
  expect(Object.keys(SHORT_TOOL_NAMES).sort()).toEqual([...accepted!].sort());
});
