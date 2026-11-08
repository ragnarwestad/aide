// What a row says when a step failed on the AI it was told to run on.
//
// The failure this pins: the row used to repeat whatever the CLI said,
// which for one of them is "Unexpected server error. Check server logs
// for details." A reader learns nothing from that and cannot tell which
// of four AIs it even came from.

import { describe, expect, test } from "bun:test";
import {
  stepDetail,
  stepFailure,
  toolFailureSentence,
} from "../../src/format/tool-failure.ts";
import { renderSentence } from "../../src/i18n/message.ts";
import { writtenMessage } from "../../src/format/error-sentence.ts";

describe("toolFailureSentence", () => {
  test("it names the AI and the model the step was on", () => {
    const s = toolFailureSentence({
      tool: "opencode",
      model: "gemini-3.1-pro",
      error: "boom",
      terminalReason: "cli-error",
    })!;
    expect(s.text).toContain("OpenCode on gemini-3.1-pro");
    expect(s.text).toContain("boom");
  });

  test("it points at the Installation tab of the provider of that AI, and at no button", () => {
    const s = toolFailureSentence({
      tool: "codex",
      model: "gpt-5.6-sol",
      terminalReason: "cli-error",
    })!;
    expect(s.text).toContain("Settings");
    expect(s.text).toContain("Providers tab");
    expect(s.text).toContain("Codex provider");
    expect(s.text).toContain("Installation tab");
    expect(s.text).not.toContain("press Check");
  });

  test("the CLI's own words are hover detail, and are in the sentence too", () => {
    const s = toolFailureSentence({
      tool: "opencode",
      model: "zen-free",
      error: "Unexpected server error. Check server logs for details.",
      terminalReason: "cli-error",
    })!;
    expect(s.title).toBe(
      "Unexpected server error. Check server logs for details.",
    );
  });

  test("a run refused before it started names the model alone", () => {
    // `aide-run-spec`'s own refusal carries no tool: it never got as far
    // as running one.
    const s = toolFailureSentence({
      model: "gemini-3.1-pro",
      error: "cannot find the opencode binary",
      terminalReason: "refused",
    })!;
    expect(s.text).toContain("gemini-3.1-pro");
    expect(s.text).not.toContain(" on gemini-3.1-pro on ");
    // Without a tool there is no provider to name by its tool.
    expect(s.text).toContain("Providers tab");
    expect(s.text).toContain("Installation");
  });

  // The shape Claude Code writes when it is not logged in: an error result
  // with no error list, so the script's fallback sentence stands.
  test("a login failure from Claude Code still sends the reader to Settings", () => {
    const s = toolFailureSentence({
      tool: "claude",
      model: "Sonnet",
      error: "provider reported an error \u2014 press Analyze again",
      terminalReason: "cli-error",
    })!;
    expect(s.text).toContain("Settings");
    expect(s.text).toContain("Claude Code provider");
    expect(s.text).toContain("Installation tab");
    expect(s.text).not.toContain("press Check");
  });

  test("a tool with no model still names the tool", () => {
    expect(
      toolFailureSentence({ tool: "claude", terminalReason: "cli-error" })!
        .text,
    ).toContain("Claude Code");
  });

  // Most refusals are the runner's own rules, not the AI: a dependency
  // not archived, a step not analyzed yet. Sending a reader to check the
  // AI's login for those sends them the wrong way. Only a refusal that
  // says the CLI could not be found is about the AI.
  test("a refusal for one of the runner's rules keeps its own sentence", () => {
    expect(
      toolFailureSentence({
        tool: "claude",
        model: "Sonnet",
        error: "spec 484-x depends on 482-y, which is not archived yet",
        terminalReason: "refused",
      }),
    ).toBeUndefined();
    const out = stepFailure(
      undefined,
      {
        error: "spec 484-x depends on 482-y, which is not archived yet",
        tool: "claude",
        terminalReason: "refused",
      },
      "Sonnet",
    );
    expect(out.error).toBe(
      "spec 484-x depends on 482-y, which is not archived yet",
    );
  });

  test("a CLI that could not be started is about the AI", () => {
    expect(
      toolFailureSentence({ tool: "codex", terminalReason: "spawn-failed" })!
        .text,
    ).toContain("Codex provider");
  });

  test("nothing to name is not a tool failure at all", () => {
    expect(
      toolFailureSentence({
        error: "something broke",
        terminalReason: "cli-error",
      }),
    ).toBeUndefined();
  });

  // The gate this file is really about: a step that failed at its own
  // work, not at its AI, keeps the sentence the script wrote. Telling a
  // reader which model was running when a push did not reach origin adds
  // nothing, and a prefix on every failure is one nobody reads.
  test("an ending that is not about the AI is left entirely alone", () => {
    for (const ending of [
      "scope-violation",
      "merge-unfinished",
      "unpushed",
      "no-progress",
      undefined,
    ]) {
      expect(
        toolFailureSentence({
          tool: "opencode",
          model: "zen-free",
          error: "x",
          terminalReason: ending,
        }),
      ).toBeUndefined();
    }
  });

  test("an unknown tool name is passed through rather than hidden", () => {
    expect(
      toolFailureSentence({ tool: "gemini", terminalReason: "cli-error" })!
        .text,
    ).toContain("gemini");
  });
});

describe("stepFailure", () => {
  test("a board message wins, and the CLI's words become its detail", () => {
    const out = stepFailure(
      { key: "runner.testsRedImplement" },
      { error: "tests failed", tool: "claude", terminalReason: "tests-red" },
      "Sonnet",
    );
    expect(out.error).toEqual({ key: "runner.testsRedImplement" });
    expect(out.errorDetail).toBe("tests failed");
  });

  test("with no board message the named sentence is the row's text", () => {
    const out = stepFailure(
      undefined,
      { error: "boom", tool: "opencode", terminalReason: "cli-error" },
      "gemini-3.1-pro",
    );
    expect(renderSentence("en", out.error as never)).toContain(
      "OpenCode on gemini-3.1-pro",
    );
    expect(out.errorDetail).toBe("boom");
  });

  test("with nothing to name, the CLI's own words stand alone", () => {
    const out = stepFailure(
      undefined,
      { error: "boom", terminalReason: "cli-error" },
      undefined,
    );
    expect(out.error).toBe("boom");
    expect(out.errorDetail).toBeUndefined();
  });

  test("with neither words nor a name, the terminal reason is the answer", () => {
    const out = stepFailure(
      undefined,
      { terminalReason: "cli-error" },
      undefined,
    );
    expect(out.error).toBe("cli-error");
  });

  test('"none" is the deterministic create path, not an AI that failed', () => {
    const out = stepFailure(
      undefined,
      { error: "boom", tool: "none", terminalReason: "cli-error" },
      "Sonnet",
    );
    expect(renderSentence("en", out.error as never)).toContain("Sonnet");
    expect(renderSentence("en", out.error as never)).not.toContain("none");
  });
});

describe("stepFailure with the runner's fix apart", () => {
  test("stores the problem and the fix as one written message (AC-4)", () => {
    const out = stepFailure(
      undefined,
      {
        error: "cannot fast-forward b",
        errorSolution: "merge it by hand",
        terminalReason: "refused",
      },
      undefined,
    );
    expect(out.error).toEqual(
      writtenMessage("cannot fast-forward b", "merge it by hand"),
    );
  });

  test("an outcome from a runner before the fix was apart keeps its plain string (AC-5)", () => {
    const out = stepFailure(
      undefined,
      { error: "cannot do x — fix y", terminalReason: "refused" },
      undefined,
    );
    expect(out.error).toBe("cannot do x — fix y");
  });
});

describe("stepDetail", () => {
  test("is the result's errorLog when it has one (AC-2)", () => {
    expect(
      stepDetail({ errorLog: "a.test.ts › works\nb.test.ts › stays" }),
    ).toBe("a.test.ts › works\nb.test.ts › stays");
  });

  test("is the runner's own error, whole, when there is no errorLog (AC-4)", () => {
    expect(stepDetail({ error: "first line\nsecond line" })).toBe(
      "first line\nsecond line",
    );
  });

  test("is nothing when the result has neither", () => {
    expect(stepDetail({})).toBeUndefined();
    expect(stepDetail({ errorLog: "  " })).toBeUndefined();
  });
});

describe("stepFailure with an errorLog", () => {
  test("a board message's detail is the errorLog (AC-2)", () => {
    const out = stepFailure(
      { key: "runner.testsRedImplement" },
      { errorLog: "a.test.ts › works", terminalReason: "tests-red" },
      "Sonnet",
    );
    expect(out.error).toEqual({ key: "runner.testsRedImplement" });
    expect(out.errorDetail).toBe("a.test.ts › works");
  });

  test("a cli-error whose words are in errorLog names the AI and the model with those words (AC-2)", () => {
    const out = stepFailure(
      undefined,
      { errorLog: "boom", tool: "opencode", terminalReason: "cli-error" },
      "gemini-3.1-pro",
    );
    const sentence = renderSentence("en", out.error as never) ?? "";
    expect(sentence).toContain("OpenCode on gemini-3.1-pro");
    expect(sentence).toContain("boom");
    expect(out.errorDetail).toBe("boom");
  });
});
