# aide-dashboard

## Table of contents

- [What it is](#what-it-is)
- [Usage](#usage)

---

## What it is

Read-only dashboard for aide projects (spec 79 in aide-specs): scans a
root for `.aide/project.yaml` manifests, resolves each project's specs
root, parses spec progress/phase from `4-status.md` files, and renders
ONE self-contained HTML page. Generated on the laptop (where the repos
live), served statically on the always-on mac mini, port 8788.

## Usage

```bash
make test        # bun test (single-run)
make generate    # write out/index.html
make publish     # generate + rsync to the mac mini
```
