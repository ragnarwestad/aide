import { describe, expect, test } from "bun:test";
import { QUEUE_DEFAULTS } from "../../../src/serve/serve-helpers/config.ts";

describe("the wiki step's built-in settings", () => {
  test("its timeout is 2400 seconds, the ceiling analyze has (AC-1)", () => {
    expect(QUEUE_DEFAULTS.timeoutSec.wiki).toBe(2400);
  });
});
