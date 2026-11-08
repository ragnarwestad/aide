// A shadow home: a Codex folder with a login of its own that shares the rest
// of a `CODEX_HOME`, so two providers on one `CODEX_HOME` can continue each
// other's sessions.

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { prepareShadowHome } from "../../../src/serve/providers/shadow-home.ts";
import { readCodexSession } from "../../../src/serve/spec-views/codex-sessions.ts";
import { feasibility, lines, S, writeSessions } from "../../helpers/codex-fixtures.ts";

const temp = () => mkdtempSync(join(tmpdir(), "shadow-home-"));
const shared = () => {
  const home = temp();
  writeSessions(home, { [S]: feasibility.child });
  writeFileSync(join(home, "config.toml"), "model = 'x'\n");
  writeFileSync(join(home, "auth.json"), '{"login":"shared"}');
  return home;
};

describe("prepareShadowHome", () => {
  test("every entry but auth.json is linked, and a session written through one is found through the other (AC-16)", () => {
    const codexHome = shared();
    const first = join(temp(), "first");
    const second = join(temp(), "second");

    expect(prepareShadowHome(codexHome, first)).toBeNull();
    expect(prepareShadowHome(codexHome, second)).toBeNull();
    writeFileSync(join(first, "auth.json"), '{"login":"first"}');
    writeFileSync(join(second, "auth.json"), '{"login":"second"}');

    expect(readlinkSync(join(first, "sessions"))).toBe(join(codexHome, "sessions"));
    expect(readCodexSession(S, second)).toBe(lines(feasibility.child));
    expect(lstatSync(join(first, "auth.json")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(second, "auth.json"), "utf8")).toBe('{"login":"second"}');
    expect(readFileSync(join(codexHome, "auth.json"), "utf8")).toBe('{"login":"shared"}');
  });

  test("an entry the CODEX_HOME gained since is linked on the next preparation, and a link already there is kept", () => {
    const codexHome = shared();
    const shadow = join(temp(), "shadow");
    prepareShadowHome(codexHome, shadow);
    mkdirSync(join(codexHome, "skills"));

    expect(prepareShadowHome(codexHome, shadow)).toBeNull();
    expect(existsSync(join(shadow, "skills"))).toBe(true);
  });

  test("an entry of the shadow home's own that is not shared state is left as it is", () => {
    const codexHome = shared();
    const shadow = join(temp(), "shadow");
    mkdirSync(shadow);
    writeFileSync(join(shadow, "log.txt"), "mine");

    expect(prepareShadowHome(codexHome, shadow)).toBeNull();
    expect(readFileSync(join(shadow, "log.txt"), "utf8")).toBe("mine");
  });

  test("a sessions folder of the shadow home's own is refused with the conflict sentence (AC-16)", () => {
    const codexHome = shared();
    const shadow = temp();
    mkdirSync(join(shadow, "sessions"));

    expect(prepareShadowHome(codexHome, shadow)).toBe(
      `${shadow} has a sessions folder of its own — start from an empty folder and log in there again`,
    );
    expect(lstatSync(join(shadow, "sessions")).isSymbolicLink()).toBe(false);
  });

  test("a config.toml of its own is refused too, and a shadow home equal to the CODEX_HOME is refused", () => {
    const codexHome = shared();
    const shadow = temp();
    writeFileSync(join(shadow, "config.toml"), "mine");

    expect(prepareShadowHome(codexHome, shadow)).toContain("has a config.toml of its own");
    expect(prepareShadowHome(codexHome, codexHome)).toContain("must differ");
  });

  test("a CODEX_HOME that is not there is refused, naming it", () => {
    const missing = join(temp(), "gone");
    expect(prepareShadowHome(missing, join(temp(), "shadow"))).toContain(missing);
  });
});

describe("prepareShadowHome after a change", () => {
  test("links point at a changed CODEX_HOME, and a missing sessions folder is made so both shadow homes share it", () => {
    const a = shared();
    const b = temp();
    const shadow = join(temp(), "s");
    prepareShadowHome(a, shadow);
    expect(prepareShadowHome(b, shadow)).toBeNull();
    expect(readlinkSync(join(shadow, "sessions"))).toBe(join(b, "sessions"));
    const other = join(temp(), "o");
    prepareShadowHome(b, other);
    expect(readlinkSync(join(other, "sessions"))).toBe(join(b, "sessions"));
    expect(existsSync(join(b, "sessions"))).toBe(true);
  });
});
