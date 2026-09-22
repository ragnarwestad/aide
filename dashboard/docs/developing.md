# Developing the dashboard

The commands for working on the dashboard itself: its tests, and running it from a checkout. Installing it for use is
in the [README](../README.md#installation).

`dashboard/` is bun and TypeScript, with commands of its own, run from inside it. They need `make`, which macOS has
and a minimal Linux may not (`sudo apt install make` on Debian and Ubuntu):

```bash
make test                           # tsc + bun test, browser tests included
make test-slow                      # the round's own tests, which start real test servers
make test-e2e                       # the browser tests alone
make test-all                       # all three — the browser tests twice, since make test has them
make serve-local                    # serves the checkout it is started in, no build step, no service
```

`make test` is what a step and a landing run for a change that stays inside `dashboard/` — the manifest scopes
that directory to this command alone, so pytest does not run for it. It deals the test files out to one bun process per core, leaving two cores free for whatever else the
machine is doing, and the whole of it takes about a minute on a 14-core machine. It leaves out the round's own tests
alone: each starts a real test server, and they lose to load on a busy machine without a fault in the change.

A change to the documentation alone, these pages included, has a command of its own at the repository root:
`scripts/check-docs` runs the tests that read a page rather than the code, in about ten seconds. A change that also
touches `dashboard/src` needs `make test` as well.

CI runs both `make test` and `make test-slow`, on a pull request only — never on a push. A change the dashboard lands
through its own merge does not reach CI at all; the landing's own run of `make test` is the gate it passes.

`make serve-local` runs the checkout it is started in, which is how a change is tried before it lands. It serves on
port 8788 unless `PORT=` names another — the installed service's own port, so on the serving host give it a different
one. `ROOT=` names the directory holding the projects; without it, there is no project navigation.
