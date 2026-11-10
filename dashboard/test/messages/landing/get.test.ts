import { expect, test } from "bun:test";
import { getLandingMessage } from "../../../src/messages/landing/get.ts";

test("a red landing test run waits for a correction; another landing failure is an error", () => {
  const landingError = { key: "landing.testsRedOnMergeFallback", values: { base: "main" } } as const;
  const waiting = getLandingMessage({ landingError, errorReason: "tests-red" }, "en");
  const failed = getLandingMessage({ landingError }, "en");
  expect(waiting?.variant).toBe("waiting");
  expect(failed?.variant).toBe("failed");
  expect(waiting?.text).toBe(failed?.text);
  expect(getLandingMessage({}, "en")).toBeUndefined();
});
