# aide-test

The round's own fixture project. Its specs are throwaway, and they exist to
exercise the machinery the dashboard and `aide-run-spec` share: the queue,
the worktrees, the push, the landing and the archive. No model is involved:
`../claude-stub` stands in for `claude`, does each step deterministically,
and costs nothing.

- `src/facts.ts` is the one file the specs change; each spec appends a fact
  and a test for it.
- `.aide/config` is not checked in here — `../run` writes it into the
  working copy at the start of every round, since the specs path is a fresh
  temp directory each time.

Everything a round needs — this project, its specs and their expected
outcomes, and the stand-in for `claude` — lives under `dashboard/test/round/`
in the aide repository. A round builds its own throwaway git origins for
this project and its specs; nothing outside this repository is required to
run one.
