Read the X list "MyAI" in Chrome and write a digest of what in it matters to Aide.

Aide is a tool for AI-assisted development: skills, rules and scripts installed for Claude Code,
Codex, OpenCode and Copilot, and a dashboard that runs specs through create, analyze, implement
and archive steps headless.

Only read. Do not post, reply, like, repost, follow or change anything on X, and change no file
in the repository: commit nothing and push nothing.

1. Use the Chrome on the machine that serves the board. Every Chrome signed in to the same Claude
   account is connected, and their names and device ids say nothing about which machine each one
   is on, so find it by a file only this machine's board serves. Nobody is there to answer a
   question: this step is the choice, so do not ask.

   Write a random token as the page title of `$AIDE_SCHEDULE_OUTPUT_DIR/browser-check.html`
   (`<!doctype html><title>TOKEN</title>`; the browser tools cannot read a plain-text page). Call
   mcp__claude-in-chrome__list_connected_browsers, and for each browser in turn:
   mcp__claude-in-chrome__select_browser with its deviceId, then
   mcp__claude-in-chrome__tabs_context_mcp with createIfEmpty true, then open
   `http://127.0.0.1:8788/schedule-output/aide/schedule-X-lista/runs/<run>/browser-check.html` in a
   new tab, where `<run>` is the last part of `$AIDE_SCHEDULE_OUTPUT_DIR`, and read `document.title`
   with mcp__claude-in-chrome__javascript_tool. Any other machine's Chrome gets an error page there.
   The browser whose title is the token is the one to use; close that tab and keep it selected.
   Close the tab in every other browser you tried. When no browser shows the token, stop: the list cannot be read,
   because this machine's Chrome is not connected.
2. Open https://x.com/i/lists/1992629307080929379 in a new tab.
3. Collect the posts with mcp__claude-in-chrome__javascript_tool, running this script exactly
   as written. Do not read posts from a screenshot or the page text: X keeps only the posts near
   the screen in the page, so what is visible is a fraction of the list. The script scrolls until
   the last three posts on the page are all older than 24 hours — one old post alone, a pinned one
   or an old one quoted, does not stop it — and returns how many posts it kept.

   ```javascript
   const since = Date.now() - 24 * 3600 * 1000;
   const clean = s => s.replace(/\S*(https?:|www\.|\.com|\.ai|\.io|\.dev)\S*/g, '[link]').replace(/[?=&;%]/g, ' ').replace(/\n+/g, ' | ');
   const seen = new Map();
   let done = false;
   window.scrollTo(0, 0);
   await new Promise(r => setTimeout(r, 1500));
   for (let round = 0; round < 60 && !done; round++) {
     const times = [];
     document.querySelectorAll('article').forEach(a => {
       const t = a.querySelector('time')?.getAttribute('datetime');
       const href = [...a.querySelectorAll('a')].map(x => x.getAttribute('href') || '').find(h => /^\/\w+\/status\/\d+$/.test(h));
       if (!t || !href) return;
       const at = Date.parse(t);
       times.push(at);
       if (at >= since && !seen.has(href)) seen.set(href, t.slice(11, 16) + ' ' + href.slice(1) + ' :: ' + clean(a.innerText).slice(0, 280));
     });
     done = times.length >= 3 && times.slice(-3).every(at => at < since);
     window.scrollBy(0, 2500);
     await new Promise(r => setTimeout(r, 1500));
   }
   window.__list = [...seen.values()];
   window.__list.length
   ```

   The tool cuts its output at about 1000 characters, so read the posts back three at a time,
   with `window.__list.slice(0, 3).join('\n\n')`, then `slice(3, 6)`, and so on until every post
   has been read. Each line starts with the time (UTC), then `handle/status/ID`. A post whose
   text ends in "Show more" is cut short; open it and read it whole when it may matter to Aide.
4. Keep only what matters to Aide: news or releases for Claude Code, Codex, OpenCode or Copilot;
   security incidents in AI coding tools; how people run agents, evals, specs, hooks, skills,
   reviews or tests; measured results. Leave out promotion, newsletters, politics, games and jokes.
5. Close the tab you opened.

Write the digest, in English, to `$AIDE_SCHEDULE_OUTPUT_DIR/digest.md`, which the weekly news check
reads:

    ## Posts

    - ICON **@handle**, HH:MM — what it says, in one or two sentences. Why it matters to Aide, in one. [post](https://x.com/handle/status/ID)
      Proposed: what to do about it in Aide.

One bullet per kept post, newest first. ICON is ⭐ (Aide should act on it), ⚠️ (a breaking change
or an incident to check), ✅ (useful, nothing to do now) or ℹ (worth knowing).

A ⭐, ⚠️ or ✅ post gets the "Proposed:" line; an ℹ post does not. It names the concrete action:
what to check first when the post is only a claim (the tool's own announcement, release notes or
docs), or what to change and where (a file, a skill, a rule, an installer, an idea for
`docs/ROADMAP.md`). When the right thing is to do nothing, say so plainly: start the line with
"Proposed: nothing —" and give the reason in the same sentence. Never leave it vague, such as
"keep an eye on it" or "worth considering".

If nothing matters, write "Nothing that matters to Aide in the last 24 hours." in place of the bullets.
End with one line: "Read N posts from the last 24 hours, kept M.", where N is the number the
script returned.

Then write the same digest as plain HTML, no styling, to `$AIDE_SCHEDULE_OUTPUT_DIR/index.html`:
that file is what the entry's page shows as the run's report, and each post's link opens it on X.

If the list cannot be read (this machine's Chrome is not connected, X asks for a login), write that reason
as the only line of both files.
