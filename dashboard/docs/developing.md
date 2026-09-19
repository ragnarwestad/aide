# Developing the dashboard

The commands for working on the dashboard itself: its tests, and running it from a checkout. Installing it for use is
in the [README](../README.md#installation).

`dashboard/` is bun and TypeScript, with commands of its own, run from inside it:

```bash
make test                           # tsc + bun test (single-run)
make generate                       # write the site to out/
make serve-local                    # generate + serve out/ on this machine, no service
AIDE_DASH_HOST=<host> make publish  # generate + rsync out/ to that host
                                    # (--delete: pages removed locally
                                    # disappear remotely too)
```

`make serve-local` runs the checkout it is started in, which is how a change is tried before it lands.
`make publish` puts the generated pages on a host as a plain static site, with no server behind them.

`AIDE_DASH_HOST` has no default: a sync aimed at a machine nobody named is worse than one that refuses to start. The
remote site directory (`~/.aide/dashboard/site` on the serving host) must remain exclusively the dashboard's: publish
syncs with `--delete`, so anything else placed there is removed on the next publish.
