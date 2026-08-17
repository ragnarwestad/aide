// The plist renderer (spec 03). The committed plist carried one
// operator's home directory into git; the renderer takes every path as
// an argument instead. What is worth proving is exactly that: nothing
// it emits comes from anywhere but its own options.
import { describe, expect, test } from "bun:test";
import { renderPlist } from "../deploy/render-plist.ts";

const OPTS = {
  label: "com.aide-dashboard.serve",
  bunPath: "/opt/bun/bin/bun",
  script: "/srv/checkout/aide-dashboard/src/serve.ts",
  workingDirectory: "/srv/checkout/aide-dashboard",
  logPath: "/srv/logs/aide-dashboard/serve.log",
  serveArgv: ["serve", "--site", "/srv/site", "--port", "8788"],
};

/** The <string> values under a given <key>, in document order. */
function strings(xml: string, key: string): string[] {
  const after = xml.split(`<key>${key}</key>`)[1] ?? "";
  const block = after.startsWith("\n  <array>") ? after.split("</array>")[0]! : after.split("\n")[1]!;
  return [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]!);
}

describe("rendering a launchd job for whichever host the operator picked", () => {
  test("every value in the XML came from the options", () => {
    const xml = renderPlist(OPTS);
    expect(strings(xml, "Label")).toEqual([OPTS.label]);
    expect(strings(xml, "ProgramArguments")).toEqual([OPTS.bunPath, "run", OPTS.script, ...OPTS.serveArgv]);
    expect(strings(xml, "WorkingDirectory")).toEqual([OPTS.workingDirectory]);
    expect(strings(xml, "StandardOutPath")).toEqual([OPTS.logPath]);
    expect(strings(xml, "StandardErrorPath")).toEqual([OPTS.logPath]);
  });

  test("no home directory, host or path leaks in from a built-in default", () => {
    const xml = renderPlist(OPTS);
    expect(xml).not.toMatch(/\/Users\//);
    expect(xml.toLowerCase()).not.toContain("macmini");
    expect(xml.toLowerCase()).not.toContain("ragnarwestad");
    // The only paths present are the ones handed in.
    for (const path of [...xml.matchAll(/<string>(\/[^<]*)<\/string>/g)].map((m) => m[1]!)) {
      expect([OPTS.bunPath, OPTS.script, OPTS.workingDirectory, OPTS.logPath, "/srv/site"]).toContain(path);
    }
  });

  test("the job starts at load and is kept alive — a dashboard nobody restarts by hand", () => {
    const xml = renderPlist(OPTS);
    expect(xml).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(xml).toContain("<key>KeepAlive</key>\n  <true/>");
  });

  test("it is a well-formed plist document", () => {
    const xml = renderPlist(OPTS);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"');
    expect(xml.trimEnd().endsWith("</plist>")).toBe(true);
  });

  test("a value carrying XML syntax is escaped, not pasted", () => {
    const xml = renderPlist({ ...OPTS, serveArgv: ["serve", "--site", "/srv/a&b<c>"] });
    expect(xml).toContain("<string>/srv/a&amp;b&lt;c&gt;</string>");
  });
});
