import { afterEach, describe, expect, test } from "bun:test";
import { TOKEN, JOB, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

describe("spec 252: the spec page's own Back link, read off the Referer header", () => {
  const auth = { "x-aide-token": TOKEN };
  const folder = "81-queue-and-runner";

  // Criterion 1.
  test("a same-origin Referer round-trips into ← Back", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (
      await fetch(`${base}/specs/aide/${folder}`, { headers: { ...auth, referer: `${base}/?state=all&q=archive` } })
    ).text();
    expect(html).toContain('<a class="backlink" href="/?state=all&amp;q=archive">← Back</a>');
  });

  // Criterion 4: absent Referer keeps today's exact fallback.
  test("no Referer at all falls back to /", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/specs/aide/${folder}`, { headers: auth })).text();
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });

  // Criterion 5.
  test("a foreign-origin Referer is discarded, falling back to /", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (
      await fetch(`${base}/specs/aide/${folder}`, { headers: { ...auth, referer: "https://evil.example/" } })
    ).text();
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });

  // Criterion 6: a same-origin Referer carrying a query-string token is
  // not reflected into the rendered link.
  test("a Referer carrying token= has it stripped from ← Back", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (
      await fetch(`${base}/specs/aide/${folder}`, {
        headers: { ...auth, referer: `${base}/?token=${TOKEN}&state=all` },
      })
    ).text();
    expect(html).toContain('<a class="backlink" href="/?state=all">← Back</a>');
  });
});

describe("spec 252: the job page's own Back link, read off the Referer header", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  const jobId = async (base: string): Promise<string> => {
    const made = await fetch(`${base}/api/queue`, { method: "POST", headers: AUTH, body: JSON.stringify(JOB) });
    const { job } = (await made.json()) as { job: { id: string } };
    return job.id;
  };

  // Criterion 1.
  test("a same-origin Referer round-trips into ← Back", async () => {
    const { base } = start({ queueToken: TOKEN });
    const id = await jobId(base);
    const html = await (
      await fetch(`${base}/specs/${id}`, { headers: { "x-aide-token": TOKEN, referer: `${base}/?state=all&q=archive` } })
    ).text();
    expect(html).toContain('<a class="backlink" href="/?state=all&amp;q=archive">← Back</a>');
  });

  // Criterion 4: absent Referer keeps today's exact fallback.
  test("no Referer at all falls back to /", async () => {
    const { base } = start({ queueToken: TOKEN });
    const id = await jobId(base);
    const html = await (await fetch(`${base}/specs/${id}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });

  // Criterion 5.
  test("a foreign-origin Referer is discarded, falling back to /", async () => {
    const { base } = start({ queueToken: TOKEN });
    const id = await jobId(base);
    const html = await (
      await fetch(`${base}/specs/${id}`, { headers: { "x-aide-token": TOKEN, referer: "https://evil.example/" } })
    ).text();
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });
});
