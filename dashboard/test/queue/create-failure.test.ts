import { describe, expect, test } from "bun:test";
import { createEndedWithoutSpec, createFailureReason, isProvisionalKey } from "../../src/queue/create-failure.ts";
import { parseCreateRequest } from "../../src/queue/parse-request.ts";
import { DEFAULTS } from "../push/fixtures.ts";

const KEY = "new-abc123de";
const create = (over: Record<string, unknown> = {}) => ({ specFolder: KEY, state: "failed", ...over });

describe("a create that ended without a spec (AC-1)", () => {
  test.each(["failed", "stopped", "interrupted"])("%s is over", (state) => {
    expect(createEndedWithoutSpec(create({ state }))).toBe(true);
  });

  test.each(["queued", "running", "cancelled", "done"])("%s is not a failure (AC-7)", (state) => {
    expect(createEndedWithoutSpec(create({ state }))).toBe(false);
  });

  test("a merge still under way is not over, whatever the state says (AC-7)", () => {
    expect(createEndedWithoutSpec(create({ state: "stopped", landing: true }))).toBe(false);
  });

  test("its own merge failing while the job went on is a failure (AC-1)", () => {
    expect(createEndedWithoutSpec(create({ state: "queued", landingError: "cannot fast-forward" }))).toBe(true);
    expect(createEndedWithoutSpec(create({ state: "queued", landingError: "x", landing: true }))).toBe(false);
  });

  test("a real spec folder never matches (AC-7)", () => {
    expect(createEndedWithoutSpec(create({ specFolder: "81-queue-and-runner" }))).toBe(false);
    expect(createEndedWithoutSpec(create({ specFolder: "schedule-weekly" }))).toBe(false);
  });
});

describe("the provisional key", () => {
  test("matches what parseCreateRequest generates", () => {
    const parsed = parseCreateRequest(
      { project: "aide", title: "A title", description: "text" },
      { allow: () => true, defaults: DEFAULTS },
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(isProvisionalKey(parsed.job.specFolder)).toBe(true);
  });

  test("is exactly new- and eight hex", () => {
    expect(isProvisionalKey("new-abc123de")).toBe(true);
    expect(isProvisionalKey("new-abc123")).toBe(false);
    expect(isProvisionalKey("new-abc123deX")).toBe(false);
    expect(isProvisionalKey("81-new-abc123de")).toBe(false);
  });
});

describe("why a create ended (AC-2)", () => {
  test("the landing's record wins over the job's error", () => {
    expect(createFailureReason({ landingError: "merge failed", error: "held back" })).toBe("merge failed");
  });
  test("then the job's own error", () => {
    expect(createFailureReason({ error: "step failed" })).toBe("step failed");
  });
  test("with none, a generic sentence", () => {
    expect(createFailureReason({})).toEqual({ key: "runner.createEndedNoReason" });
  });
});
