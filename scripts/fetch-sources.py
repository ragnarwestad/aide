#!/usr/bin/env python3
"""fetch-sources - Fetch every address in the "### Sources" table of docs/AI_NEWS_LOG.md
and write each one's own text to a file, for the news check to read whole.

A tool's WebFetch hands back a model's summary of a page, which can leave out or
contradict what the page says. This fetches with curl and keeps the text:

- a GitHub releases page is read from GitHub's API, which gives every release's
  notes in full (the newest 20); with --since, releases published before that
  date are left out, and a page that holds nothing older says more may exist
- any other page is reduced to its text, as scripts/watch-pages.py does

One line per address, in table order: `fetched <tool> <address> <file>` or
`failed <tool> <address> <reason>`. Exits 1 when any address failed.

A page drawn in the browser by JavaScript has little text in its HTML, so its
file says little; a release page needs no login, and GitHub allows 60 such
requests an hour from one address.

usage: scripts/fetch-sources.py [--log PATH] [--out DIR] [--since YYYY-MM-DD]
  --log    the news log (default: docs/AI_NEWS_LOG.md in the repo the script sits in)
  --out    where the files are written (default: ~/.aide/news-check/sources)
  --since  leave out releases published before this date

Standard library only, and nothing newer than Python 3.9.
"""
import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

SECTION = "### Sources"
PAGE_SIZE = 20
HERE = Path(__file__).resolve().parent


def _watch_pages():
    spec = importlib.util.spec_from_file_location("watch_pages", HERE / "watch-pages.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


watch_pages = _watch_pages()


def sources(log_text):
    """The `(tool, address)` pairs of the `### Sources` table, in table order."""
    pairs = []
    inside = False
    for line in log_text.splitlines():
        if line.strip() == SECTION:
            inside = True
            continue
        if not inside:
            continue
        if line.startswith("#"):
            break
        if not line.lstrip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        for cell in cells[1:]:
            for address in re.findall(r"<([a-z]+://[^>]+)>", cell):
                pairs.append((cells[0], address))
    return pairs


def releases_api(address):
    """The API address that lists a GitHub releases page's releases, or None for any other page."""
    found = re.fullmatch(r"https://github\.com/([^/]+)/([^/]+)/releases/?", address)
    if not found:
        return None
    return "https://api.github.com/repos/%s/%s/releases?per_page=%d" % (found.groups() + (PAGE_SIZE,))


def releases_text(api_json, since=None):
    """Every release published on or after `since`, newest first, each with its whole notes."""
    parts = []
    releases = json.loads(api_json)
    for release in releases:
        published = (release.get("published_at") or "")[:10]
        if since and published and published < since:
            continue
        label = release.get("tag_name") or release.get("name") or "?"
        if release.get("prerelease"):
            label += " (pre-release)"
        parts.append("## %s, %s\n\n%s" % (label, published or "no date", (release.get("body") or "").strip()))
    if not parts:
        return "No release since %s." % since
    if since and len(parts) == len(releases) == PAGE_SIZE:
        parts.append("Only the newest %d releases were fetched, all since %s: there may be more releases "
                     "in the period; read the rest on the releases page." % (PAGE_SIZE, since))
    return "\n\n".join(parts)


def file_name(address):
    return re.sub(r"[^A-Za-z0-9.]+", "-", address.split("://", 1)[-1]).strip("-") + ".txt"


def fetch_text(address, since):
    """The address's text, or (None, the reason it failed)."""
    api = releases_api(address)
    body, error = watch_pages.fetch(api or address)
    if body is None:
        # A large answer is sometimes cut off mid-stream; a second try usually gets it whole.
        body, error = watch_pages.fetch(api or address)
    if body is None:
        return None, error
    if api:
        try:
            return releases_text(body, since), None
        except (ValueError, AttributeError) as problem:
            return None, "the API did not answer with releases: %s" % problem
    return watch_pages.page_text(body), None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--log", default=str(HERE.parent / "docs" / "AI_NEWS_LOG.md"))
    parser.add_argument("--out", default=str(Path.home() / ".aide" / "news-check" / "sources"))
    parser.add_argument("--since")
    args = parser.parse_args(argv)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    failed = False
    for tool, address in sources(Path(args.log).read_text()):
        text, error = fetch_text(address, args.since)
        if text is None:
            failed = True
            print("failed   %s %s %s" % (tool, address, error))
            continue
        path = out / file_name(address)
        path.write_text(text + "\n")
        print("fetched  %s %s %s" % (tool, address, path))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
