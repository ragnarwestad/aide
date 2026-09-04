import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
} from "../../src/render.ts";
import {
  TOKEN,
  JOB,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});


describe("spec 231: Reset confirmation routes", () => {
  const auth = { "x-aide-token": TOKEN };
  const folder = "81-queue-and-runner";

  test("the active spec has a dedicated typed-confirmation page", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/specs/aide/${folder}/reset`, { headers: auth });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`data-confirm="${folder}"`);
    expect(html).toContain(`/api/queue/specs/aide/${folder}/reset`);
  });

  test("missing or mismatched confirmation creates no job", async () => {
    const { base } = start({ queueToken: TOKEN });
    for (const confirm of ["", `${folder}-wrong`]) {
      const res = await fetch(`${base}/api/queue/specs/aide/${folder}/reset`, {
        method: "POST",
        headers: { ...auth, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      expect(res.status).toBe(400);
    }
    const jobs = await (await fetch(`${base}/api/queue`, { headers: auth })).json() as { jobs: unknown[] };
    expect(jobs.jobs).toHaveLength(0);
  });
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

describe("no token configured", () => {
  test("every queue route is 503; /api/aide-runs and POST /api/aide-run are unaffected", async () => {
    const { base } = start();
    for (const [path, init] of [
      // Spec 100: `/` is the list now, so it is behind the token like
      // every other read route on the queue surface — including the two
      // old addresses, which redirect to it only once the token is in.
      ["/", {}],
      ["/queue", {}],
      ["/specs", {}],
      ["/specs/abc", {}],
      ["/api/queue", {}],
      ["/api/queue/abc/approve", { method: "POST" }],
      ["/api/queue/abc/cancel", { method: "POST" }],
      // Spec 189's stream is on the same surface and behind the same
      // guard — a held-open connection outside it would be a bypass
      // that told anyone who could reach the port when work moved.
      ["/api/queue/events", {}],
    ] as const) {
      const res = await fetch(`${base}${path}`, init);
      expect(res.status).toBe(503);
      expect((await res.text()).toLowerCase()).toContain("token");
    }
    expect((await fetch(`${base}/api/aide-runs`)).status).toBe(200);
    // The static overview kept its own address and its own openness: it
    // moved off `/`, not behind the token.
    expect((await fetch(`${base}/projects.html`)).status).toBe(200);
    const emitted = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s1", command: "implement", spec: "81" }),
    });
    expect(emitted.status).toBe(200);
  });
});

describe("token configured", () => {
  test("a queue request without the token is 401", async () => {
    const { base } = start({ queueToken: TOKEN });
    expect((await fetch(`${base}/`)).status).toBe(401);
    expect((await fetch(`${base}/queue`)).status).toBe(401);
    expect((await fetch(`${base}/specs`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue`, { method: "POST", body: JSON.stringify(JOB) })).status).toBe(401);
    expect((await fetch(`${base}/?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/queue?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/specs?token=wrong`)).status).toBe(401);
    // Spec 189: and the event stream, which `EventSource` reaches with
    // the page's cookie and nothing else.
    expect((await fetch(`${base}/api/queue/events`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue/events?token=wrong`)).status).toBe(401);
  });

  test("the spec 80 emitter route stays open — a 401 there would empty /api/aide-runs silently", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s1", command: "analyze", spec: "81" }),
    });
    expect(res.status).toBe(200);
    expect((await fetch(`${base}/api/aide-runs`)).status).toBe(200);
  });

  test("GET /?token=… returns 200 and sets an HttpOnly cookie; the cookie then suffices", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`aide_token_${server.port}=`);
    expect(cookie).toContain("HttpOnly");
    // Lax, never Strict: a Strict cookie is withheld on a top-level
    // navigation that started somewhere else, and an installed app
    // launched from the home screen is one — the dashboard opened on
    // "unauthorized" on a phone whose browser was signed in
    // (2026-08-22). Lax still keeps it off a cross-site POST.
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("SameSite=Strict");
    const jar = cookie.split(";")[0];
    expect((await fetch(`${base}/`, { headers: { cookie: jar } })).status).toBe(200);
  });

  // The sort lived in the query string alone, and every plain link to
  // `/` there is threw it away: the Specs tab, the redirect after
  // Create, a bookmark, the installed app's launch. The reader picked
  // Started, went to a spec, came back, and was on the default again
  // (asked for 2026-08-23).
  describe("the column the reader sorted by is remembered", () => {
    /** The `Set-Cookie` this route writes for the sort, if any. */
    const sortCookie = (res: Response, port: number | undefined): string =>
      res.headers.getSetCookie().find((c) => c.startsWith(`aide_sort_${port}=`)) ?? "";
    /** Which column the rendered table says it is sorted by. */
    const sortedBy = (html: string): string =>
      /<a class="sortlink on[^"]*"[^>]*>([A-Za-z]+)</.exec(html)?.[1] ?? "";

    test("choosing one writes it down, and a bare / gets it back", async () => {
      const { base, server } = start({ queueToken: TOKEN });
      const chosen = await fetch(`${base}/?token=${TOKEN}&sort=started`);
      expect(sortCookie(chosen, server.port)).toContain(`aide_sort_${server.port}=started`);
      expect(sortedBy(await chosen.text())).toBe("Time");
      const jar = sortCookie(chosen, server.port).split(";")[0]!;
      // The Specs tab: `/` with nothing on it. The token rides along
      // because every request needs it, not because the sort does.
      const plain = await fetch(`${base}/`, { headers: { cookie: `aide_token_${server.port}=${TOKEN}; ${jar}` } });
      expect(sortedBy(await plain.text())).toBe("Time");
    });

    // Pressing a heading never reloads the page — the script rewrites
    // the address and fetches the rows alone. A cookie written only on
    // the whole page would never be written by the act of choosing.
    test("the rows-only fetch writes it too", async () => {
      const { base, server } = start({ queueToken: TOKEN });
      const res = await fetch(`${base}/?token=${TOKEN}&sort=cost&rows=1`);
      expect(sortCookie(res, server.port)).toContain(`aide_sort_${server.port}=cost`);
    });

    test("a link that names a sort still wins over what is remembered", async () => {
      const { base, server } = start({ queueToken: TOKEN });
      const res = await fetch(`${base}/?sort=state`, {
        headers: { cookie: `aide_token_${server.port}=${TOKEN}; aide_sort_${server.port}=started|desc` },
      });
      expect(sortedBy(await res.text())).toBe("State");
      // And it becomes the new memory, so the next bare `/` agrees with
      // what the reader is looking at.
      expect(sortCookie(res, server.port)).toContain(`aide_sort_${server.port}=state`);
    });

    // Spec 317 changed the default sort from Spec to Created.
    test("with nothing remembered the default stands", async () => {
      const { base, server } = start({ queueToken: TOKEN });
      const res = await fetch(`${base}/?token=${TOKEN}`);
      expect(sortedBy(await res.text())).toBe("Created");
      expect(sortCookie(res, server.port)).toBe("");
    });
  });

  // The State filter lived in the query string alone too, and every
  // plain link to `/` threw it away the same way the sort was until the
  // fix above — the Specs tab, a bookmark, the back button (spec 338).
  describe("the state filter the reader chose is remembered", () => {
    /** The `Set-Cookie` this route writes for the state filter, if any. */
    const stateCookie = (res: Response, port: number | undefined): string =>
      res.headers.getSetCookie().find((c) => c.startsWith(`aide_state_${port}=`)) ?? "";
    /** Which state the rendered trigger says is chosen — its label,
     *  without the count beside it (spec 374 dropped the "States:"
     *  prefix in favour of the label and count alone). */
    const triggerLabel = (html: string): string =>
      /<summary[^>]*>([^<]*) \(\d+\)/.exec(html)?.[1] ?? "";

    test("choosing one writes it down, and a bare / gets it back", async () => {
      const { base, server } = start({ queueToken: TOKEN });
      const chosen = await fetch(`${base}/?token=${TOKEN}&state=not-archived`);
      expect(stateCookie(chosen, server.port)).toContain(`aide_state_${server.port}=not-archived`);
      expect(triggerLabel(await chosen.text())).toBe("Active");
      const jar = stateCookie(chosen, server.port).split(";")[0]!;
      // The Specs tab: `/` with nothing on it.
      const plain = await fetch(`${base}/`, { headers: { cookie: `aide_token_${server.port}=${TOKEN}; ${jar}` } });
      expect(triggerLabel(await plain.text())).toBe("Active");
    });

    // Pressing an option never reloads the page — the script rewrites
    // the address and fetches the rows alone. A cookie written only on
    // the whole page would never be written by the act of choosing.
    test("the rows-only fetch writes it too", async () => {
      const { base, server } = start({ queueToken: TOKEN });
      const res = await fetch(`${base}/?token=${TOKEN}&state=done&rows=1`);
      expect(stateCookie(res, server.port)).toContain(`aide_state_${server.port}=done`);
    });

    test("a link that names a state still wins over what is remembered, including All", async () => {
      const { base, server } = start({ queueToken: TOKEN });
      const res = await fetch(`${base}/?state=all`, {
        headers: { cookie: `aide_token_${server.port}=${TOKEN}; aide_state_${server.port}=not-archived` },
      });
      expect(triggerLabel(await res.text())).toBe("All");
      // And it becomes the new memory, so the next bare `/` agrees with
      // what the reader is looking at.
      expect(stateCookie(res, server.port)).toContain(`aide_state_${server.port}=all`);
    });

    test("with nothing remembered the default (All) stands", async () => {
      const { base, server } = start({ queueToken: TOKEN });
      const res = await fetch(`${base}/?token=${TOKEN}`);
      expect(triggerLabel(await res.text())).toBe("All");
      expect(stateCookie(res, server.port)).toBe("");
    });

    // REQ-5: the search term is not a citizen of this mechanism.
    test("a remembered search term never comes back on a bare /, even while a remembered state does", async () => {
      const { base, server } = start({ queueToken: TOKEN });
      const chosen = await fetch(`${base}/?token=${TOKEN}&state=not-archived&q=foo`);
      const jar = stateCookie(chosen, server.port).split(";")[0]!;
      const plain = await fetch(`${base}/`, { headers: { cookie: `aide_token_${server.port}=${TOKEN}; ${jar}` } });
      const html = await plain.text();
      expect(triggerLabel(html)).toBe("Active");
      expect(html).not.toContain('value="foo"');
    });
  });

  // Spec 350, REQ-3/REQ-4/REQ-5: the language, remembered the same way
  // as the sort column and the state filter above.
  describe("the language the reader chose is remembered", () => {
    const langCookie = (res: Response): string =>
      res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=")) ?? "";

    test("?lang=nb sets the cookie and renders Norwegian, on that same response", async () => {
      const { base } = start({ queueToken: TOKEN });
      const res = await fetch(`${base}/?token=${TOKEN}&lang=nb`);
      expect(langCookie(res)).toContain("aide_lang=nb");
      const html = await res.text();
      expect(html).toContain('<html lang="nb">');
      expect(html).toContain(">Ny<");
    });

    test("a later GET / with the cookie and no ?lang= is Norwegian too", async () => {
      const { base, server } = start({ queueToken: TOKEN });
      const chosen = await fetch(`${base}/?token=${TOKEN}&lang=nb`);
      const jar = langCookie(chosen).split(";")[0]!;
      const plain = await fetch(`${base}/`, { headers: { cookie: `aide_token_${server.port}=${TOKEN}; ${jar}` } });
      expect(await plain.text()).toContain('<html lang="nb">');
    });

    test("no cookie and no ?lang= renders English", async () => {
      const { base } = start({ queueToken: TOKEN });
      const res = await fetch(`${base}/?token=${TOKEN}`);
      expect(await res.text()).toContain('<html lang="en">');
      expect(langCookie(res)).toBe("");
    });

    test("the rows-only fetch writes the cookie too", async () => {
      const { base } = start({ queueToken: TOKEN });
      const res = await fetch(`${base}/?token=${TOKEN}&lang=nb&rows=1`);
      expect(langCookie(res)).toContain("aide_lang=nb");
    });
  });

  test("the header works for API callers", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jobs: [] });
  });

  test("a form POST answers 303 to /; a JSON caller gets JSON", async () => {
    const { base } = start({ queueToken: TOKEN });
    const form = await fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
    });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/");

    const json = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      // A different step: the same one is refused while the first is
      // unfinished, which is a separate rule with its own tests.
      body: JSON.stringify({ ...JOB, steps: ["implement"] }),
    });
    expect(json.status).toBe(200);
    const listed = (await (await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } })).json()) as {
      jobs: { project: string }[];
    };
    expect(listed.jobs.length).toBe(2);
  });

  test("an unknown project is 400 and stores nothing; an oversize body is 413", async () => {
    const { base } = start({ queueToken: TOKEN });
    const bad = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ ...JOB, project: "claude-usage" }),
    });
    expect(bad.status).toBe(400);
    const big = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ ...JOB, pad: "x".repeat(5000) }),
    });
    expect(big.status).toBe(413);
    const listed = (await (await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } })).json()) as {
      jobs: unknown[];
    };
    expect(listed.jobs).toEqual([]);
  });

  test("cancel marks the job cancelled", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const id = made.job.id;
    expect((await fetch(`${base}/api/queue/${id}/cancel`, { method: "POST", headers })).status).toBe(200);
    const after = (await (await fetch(`${base}/api/queue`, { headers })).json()) as {
      jobs: { id: string; state: string }[];
    };
    expect(after.jobs.find((j) => j.id === id)?.state).toBe("cancelled");
    expect((await fetch(`${base}/api/queue/nope/cancel`, { method: "POST", headers })).status).toBe(404);
  });

  // Only a job that still owns its work can be cancelled. A finished
  // job's state is history — done, failed, stopped — and Cancel must not
  // rewrite it to "cancelled" as though someone had ended the run.
  test("cancel refuses a job that has already finished, and leaves its state alone", async () => {
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    for (const state of ["done", "failed", "stopped", "cancelled", "interrupted"]) {
      const site = mkdtempSync(join(tmpdir(), "aide-cancel-finished-"));
      ownDirs.push(site);
      const id = `fin-${state}`;
      writeFileSync(join(site, "queue.json"), JSON.stringify([{
        id, project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0, state,
        budgetUsd: 3, jobCapUsd: 10, timeoutSec: { default: 1200 }, permissionMode: {}, model: {},
        createdAt: "2026-08-17T00:00:00Z", finishedAt: "2026-08-17T00:10:00Z",
      }]));
      const { base } = start({ queueToken: TOKEN, queueMirrorPath: join(site, "queue.json") });
      const res = await fetch(`${base}/api/queue/${id}/cancel`, { method: "POST", headers });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain(state);
      const after = (await (await fetch(`${base}/api/queue`, { headers })).json()) as {
        jobs: { id: string; state: string }[];
      };
      expect(after.jobs.find((j) => j.id === id)?.state).toBe(state);
      harness.cleanup();
    }
  });
});
