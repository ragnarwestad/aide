import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MESSAGES } from "../../../src/i18n/messages.ts";

test("Archive and Implement share the same advice for an unexplained test failure", () => {
  expect(MESSAGES["runner.testsRedArchive"].solution).toEqual(MESSAGES["runner.testsRedImplement"].solution);
});

test("the runner log gives the same test-failure advice as the board", () => {
  const script = readFileSync(new URL("../../../../core/scripts/lib/run-spec/turn/step-tests.sh", import.meta.url), "utf8");
  const advice = script.match(/stop_step tests-red "[\s\S]*?" "([^"\n]+)"/)?.[1];
  expect(advice?.replaceAll("$step_button", "{button}")).toBe(MESSAGES["runner.testsRedImplement"].solution.en);
});
