// A step whose AI tool failed says why in the board's own words when the
// runner could sort the provider's error: not logged in, the provider's own
// side, or the error's own first line. The tool's whole message stays as
// the (?) detail.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "../runner-fixtures.ts";
import { formatSentence } from "../../../../src/messages/format.ts";
import { getCliErrorMessage } from "../../../../src/messages/jobs/outcomes.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

// What the runner wrote for a real Codex step that was not logged in.
const CODEX_401 =
  "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, " +
  "url: https://api.openai.com/v1/responses, cf-ray: a37e466ae83c56bd-OSL — press Implement again";

const failed = (outcome: Record<string, unknown>) => ({ ok: false, terminalReason: "cli-error", ...outcome });

describe("getCliErrorMessage", () => {
  test("a tool that is not logged in keeps the cause (AC-6)", () => {
    const m = getCliErrorMessage("implement", failed({ tool: "codex", providerError: { kind: "login", message: "token expired" } }));
    expect(m).toEqual({ key: "runner.cliErrorLogin", values: { tool: "Codex", cause: "token expired", button: "Implement" } });
  });

  test("a failure on the provider's side is told to try again in a while", () => {
    const m = getCliErrorMessage("analyze", failed({ tool: "claude", providerError: { kind: "provider", message: "overloaded" } }));
    expect(m).toEqual({ key: "runner.cliErrorProvider", values: { tool: "Claude Code", cause: "overloaded", button: "Analyze" } });
  });

  test("forbidden, network and silent failures have distinct sentences (AC-4, AC-5, AC-7)", () => {
    expect(getCliErrorMessage("implement", failed({ tool: "codex", providerError: { kind: "forbidden", message: "403 policy" } }))).toEqual({
      key: "runner.cliErrorForbidden", values: { tool: "Codex", cause: "403 policy", button: "Implement" },
    });
    expect(getCliErrorMessage("implement", failed({ tool: "codex", providerError: { kind: "network", message: "ENOTFOUND" } }))).toEqual({
      key: "runner.cliErrorNetwork", values: { tool: "Codex", cause: "ENOTFOUND", button: "Implement" },
    });
    expect(getCliErrorMessage("implement", failed({ tool: "codex", providerError: { kind: "silent" } }))).toEqual({
      key: "runner.cliErrorSilent", values: { tool: "Codex", button: "Implement" },
    });
  });

  test("any other error is given as its own first line", () => {
    const m = getCliErrorMessage(
      "analyze",
      failed({ tool: "opencode", providerError: { kind: "other", message: "the model refused the turn" } }),
    );
    expect(m).toEqual({
      key: "runner.cliErrorOther",
      values: { tool: "OpenCode", cause: "the model refused the turn", button: "Analyze" },
    });
  });

  test("with no sorted error, no tool, or another ending, there is no message of this kind", () => {
    expect(getCliErrorMessage("analyze", failed({ tool: "codex" }))).toBeUndefined();
    expect(getCliErrorMessage("analyze", failed({ providerError: { kind: "login" } }))).toBeUndefined();
    expect(getCliErrorMessage("analyze", failed({ tool: "codex", providerError: { kind: "other" } }))).toBeUndefined();
    expect(
      getCliErrorMessage("analyze", { ok: false, terminalReason: "timeout", tool: "codex", providerError: { kind: "login" } }),
    ).toBeUndefined();
  });
});

describe("a Codex step that was not logged in", () => {
  const notLoggedIn = () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner({
      readResult: () => ({
        ...okResult(0.1),
        ...failed({ tool: "codex", error: CODEX_401, providerError: { kind: "login", message: "unexpected status 401" } }),
      }),
    });
    runner.tick();
    runner.poll();
    return store.get(job.id);
  };

  test("ends failed saying to log in, with the tool's own words behind the (?)", () => {
    const after = notLoggedIn();
    expect(after?.state).toBe("failed");
    expect(after?.error).toEqual({ key: "runner.cliErrorLogin", values: { tool: "Codex", cause: "unexpected status 401", button: "Implement" } });
    expect(after?.errorDetail).toBe(CODEX_401);
  });

  test("reads in Norwegian as the tool not being logged in on the machine that runs Aide", () => {
    const text = formatSentence("nb", notLoggedIn()?.error as Parameters<typeof formatSentence>[1]) ?? "";
    expect(text).toContain("Codex er ikke logget inn på maskinen som kjører Aide");
    expect(text).toContain("trykk så Implement igjen");
  });
});
