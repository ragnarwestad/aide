// Where a Codex session file is found: under CODEX_HOME, else `.codex` in
// the home folder, as `codex_provider_limit` in bash finds it. The two are
// edited by hand together, so this reads the bash side's own text.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { codexHome, readCodexSession } from "../../../src/serve/spec-views/codex-sessions.ts";
import { feasibility, lines, S, sessionPath, T, writeSessions } from "../../helpers/codex-fixtures.ts";

const tempHome = () => mkdtempSync(join(tmpdir(), "codex-home-"));

describe("readCodexSession", () => {
  test("a thread's file under the home's sessions folder is read as text (AC-2)", () => {
    const home = tempHome();
    writeSessions(home, { [S]: feasibility.child });

    expect(readCodexSession(S, home)).toBe(lines(feasibility.child));
    expect(readCodexSession(T, home)).toBeUndefined();
  });

  test("the home is CODEX_HOME, else .codex in the home folder (AC-2)", () => {
    expect(codexHome({ CODEX_HOME: "/somewhere/codex", HOME: "/home/x" })).toBe("/somewhere/codex");
    expect(codexHome({ HOME: "/home/x" })).toBe(join("/home/x", ".codex"));
    expect(codexHome({ CODEX_HOME: "", HOME: "/home/x" })).toBe(join("/home/x", ".codex"));
  });

  test("a thread with no file, a path, a directory, or an empty file gives undefined and never throws (AC-4)", () => {
    const home = tempHome();
    mkdirSync(join(home, sessionPath(T)), { recursive: true });
    writeFileSync(join(home, sessionPath(S)), "");

    expect(readCodexSession("01a10bd3-0000-7000-8000-000000000000", home)).toBeUndefined();
    expect(readCodexSession("../x", home)).toBeUndefined();
    expect(readCodexSession(T, home)).toBeUndefined();
    expect(readCodexSession(S, home)).toBeUndefined();
    expect(readCodexSession(S, join(home, "nowhere"))).toBeUndefined();
  });

  // The same rule `codex_provider_limit` follows in bash, read from its own text.
  test("the rule is provider-limit.sh's: the same home, folder and file name (AC-2)", async () => {
    const bash = await Bun.file(new URL("../../../../core/scripts/lib/run-spec/turn/provider-limit.sh", import.meta.url)).text();
    const fallback = /home="\$\{CODEX_HOME:-\$HOME\/([^}]+)\}"/.exec(bash)?.[1];
    const folder = /\$home\/(\w+)"/.exec(bash)?.[1];
    const name = /-name "(rollout-\*-)\$thread(\.jsonl)"/.exec(bash);

    expect(fallback).toBe(".codex");
    expect(folder).toBe("sessions");
    expect(name).not.toBeNull();
    expect(codexHome({ HOME: "/h" })).toBe(join("/h", fallback!));
    const home = tempHome();
    mkdirSync(join(home, folder!, "2026", "10", "05"), { recursive: true });
    writeFileSync(join(home, folder!, "2026", "10", "05", `${name![1]!.replace("*", "2026-10-05T13-34-08")}${S}${name![2]}`), lines(feasibility.child));
    expect(readCodexSession(S, home)).toBe(lines(feasibility.child));
  });
});
