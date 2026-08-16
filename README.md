# aide-dashboard

## Table of contents

- [What it is](#what-it-is)
- [URL scheme](#url-scheme)
- [Usage](#usage)
- [Live runs (spec 80)](#live-runs-spec-80)
- [Serving on the mac mini](#serving-on-the-mac-mini)

---

## What it is

Dashboard for aide projects (specs in aide-specs): scans a root for
`.aide/project.yaml` manifests, resolves each project's specs root,
parses spec progress/phase from `4-status.md` files, and renders a
small static site — an overview page plus one page per project, all
sharing a left-column nav. Generated on the laptop (where the repos
live), served on the always-on mac mini, port 8788, by a small Bun
server that also receives live aide-run events.

## URL scheme

- `/` — overview: every project with description and active/archived
  spec counts
- `/<slug>.html` — one page per project (slug = lowercased name,
  non-alphanumerics → hyphens; collisions get `-2`, `-3`, …)
- `/live` — aide runs in flight (server-rendered, refreshes every 10 s)
- `/api/aide-runs` — the same rows as JSON; `POST /api/aide-run`
  receives one event

Keep the scheme stable: the pages are linked from outside.

## Usage

```bash
make test           # tsc + bun test (single-run)
make generate       # write the site to out/
make publish        # generate + rsync out/ to the mac mini (--delete:
                    # pages removed locally disappear remotely too)
make install-serve  # clone/pull + bun install + launchd job on the mini
make deploy-serve   # same — for updates
```

The remote site directory (`~/aide-dashboard/site` on the mini) must
remain exclusively the dashboard's: publish syncs with `--delete`, so
anything else placed there is removed on the next publish.

## Live runs (spec 80)

A Claude Code `UserPromptSubmit` hook (`aide-emit-run`, installed by
aide to `~/.local/bin`) POSTs one small event per slash-launched
`/aide-*` command — host, session id, command, spec, project; never
the prompt text. It is inert until `AIDE_RUN_URL` is set. aide's
`install.sh` prints the ready-to-paste block; on this laptop it lives
in `~/.claude/settings.json` as:

```json
"UserPromptSubmit": [{ "hooks": [{ "type": "command",
  "command": "AIDE_RUN_URL=\"http://rw-macmini-m2:8788/api/aide-run\" '/Users/<you>/.local/bin/aide-emit-run'" }] }]
```

`/live` merges the stored runs with claude-usage's `/api/live`
(same host — but claude-usage there binds its Tailscale IP only, so
the plist passes `--claude-usage http://100.115.106.17:8787`; fetched
lazily and cached 5 s): liveness
state, subagent count and cost so far. claude-usage unreachable →
rows render without enrichment and a notice; never an error. Runs are
kept in memory (LRU 512) and mirrored to `~/aide-dashboard/aide-runs.json`
so restarts keep them.

## Serving on the mac mini

`deploy/com.ragnarwestad.aide-dashboard-serve.plist` runs
`bun run src/serve.ts serve --site ~/aide-dashboard/site --port 8788`
from a checkout at `~/develop/aide-dashboard` (bun via the mise shim
path — bare `bun` is not on launchd's PATH). Logs:
`~/Library/Logs/aide-dashboard/serve.log`.
