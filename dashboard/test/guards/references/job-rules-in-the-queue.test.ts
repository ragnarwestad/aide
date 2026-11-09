import { expect, test } from "bun:test";
import { dirname, join, normalize } from "node:path";
import { read, ROOT } from "../source.ts";

const sources = read("src/**/*.ts");

test("job-kind and activity rules have one definition in the queue (AC-1, AC-2)", () => {
  expect(sources.length).toBeGreaterThan(200);
  const outside = sources.filter(({ file }) => !file.startsWith("src/queue/"));
  const forbidden = /\b(closeOrReopenStep|deployStep|cleanupStep|isDeployJob|isCleanupJob|isScheduleJob|specWriteInFlight|UNFINISHED)\b/;
  expect(outside.filter(({ text }) => forbidden.test(text)).map(({ file }) => file)).toEqual([]);
  const copiedActivity = /state\s*===\s*["'](?:queued|running)["'][^\n]{0,100}\|\|[^\n]{0,100}(?:state\s*===\s*["'](?:queued|running)["']|\.landing)/;
  expect(outside.filter(({ text }) => copiedActivity.test(text)).map(({ file }) => file)).toEqual([]);
});

test("routes import no runtime job rule from render (AC-3)", () => {
  const imports = read("src/serve/routes/**/*.ts").flatMap(({ file, text }) =>
    [...text.matchAll(/import(?!\s+type\b)[\s\S]*?from\s+["']([^"']+)["']/g)].flatMap((match) => {
      const path = match[1]!;
      if (!path.startsWith(".")) return [];
      const resolved = normalize(join(dirname(file), path));
      return resolved.startsWith("src/render/") && /(jobDismissible|inFlight|jobsShown)/.test(match[0]!) ? [`${file}: ${path}`] : [];
    }),
  );
  expect(imports).toEqual([]);
});

test("Deploy and Cleanup use the shared board-step writer (AC-4)", () => {
  const byFile = new Map(sources.map((source) => [source.file, source.text]));
  expect(byFile.get("src/serve/deploy-job/run.ts")).toContain("boardStep(");
  expect(byFile.get("src/serve/process-cleanup/job.ts")).toContain("boardStep(");
  expect(ROOT).toBeTruthy();
});
