# Developing the dashboard

The commands for working on the dashboard itself: its tests, and running it from a checkout. Installing it for use is
in the [README](../README.md#installation).

`dashboard/` is bun and TypeScript, with commands of its own, run from inside it:

```bash
make test                           # tsc + bun test (single-run)
make generate                       # write the site to out/
make serve-local                    # generate + serve out/ on this machine, no service
```

`make serve-local` runs the checkout it is started in, which is how a change is tried before it lands.
