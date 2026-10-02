// The Config tab's choice of how strictly Analyze checks the acceptance
// criteria: the stored values, in the order the select lists them.

import { describe, expect, test } from "bun:test";
import { criteriaChecksChoices } from "../../../src/render/pages/projects-page/settings-table.ts";

describe("the criteria checks choice", () => {
  test("offers off, warn and stop, in that order (AC-1)", () => {
    expect(criteriaChecksChoices().map((o) => o.value)).toEqual(["off", "warn", "stop"]);
  });
});
