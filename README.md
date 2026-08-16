# aide-dashboard

## Table of contents

- [What it is](#what-it-is)
- [URL scheme](#url-scheme)
- [Usage](#usage)

---

## What it is

Read-only dashboard for aide projects (specs in aide-specs): scans a
root for `.aide/project.yaml` manifests, resolves each project's specs
root, parses spec progress/phase from `4-status.md` files, and renders
a small static site — an overview page plus one page per project, all
sharing a left-column nav. Generated on the laptop (where the repos
live), served statically on the always-on mac mini, port 8788.

## URL scheme

- `/` — overview: every project with description and active/archived
  spec counts
- `/<slug>.html` — one page per project (slug = lowercased name,
  non-alphanumerics → hyphens; collisions get `-2`, `-3`, …)

Keep the scheme stable: the pages are linked from outside.

## Usage

```bash
make test        # tsc + bun test (single-run)
make generate    # write the site to out/
make publish     # generate + rsync out/ to the mac mini (--delete:
                 # pages removed locally disappear remotely too)
make install-serve  # one-time launchd setup on the mini
```

The remote target directory (`aide-dashboard/site` on the mini) must
remain exclusively the dashboard's: publish syncs with `--delete`, so
anything else placed there is removed on the next publish.
