# Developing the dashboard

The commands for working on the dashboard itself: its tests, and running it from a checkout. Installing it for use is
in the [README](../README.md#installation).

`dashboard/` is bun and TypeScript, with commands of its own, run from inside it. They need `make`, which macOS has
and a minimal Linux may not (`sudo apt install make` on Debian and Ubuntu):

```bash
make test                           # tsc + bun test, browser tests included
make test-slow                      # the round's own tests, which start real boards
make test-e2e                       # the browser tests alone
make generate                       # write the site to out/
make serve-local                    # generate + serve out/ on this machine, no service
```

`make test` is what every step and every landing runs, browser tests included — one bun process per core, so the
whole of it is about a minute. It leaves out the round's own tests alone: each starts a real board and they lose to
load on a busy machine without a fault in the change. CI runs both.

`make serve-local` runs the checkout it is started in, which is how a change is tried before it lands.
