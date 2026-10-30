#!/usr/bin/env python3
"""watch-pages - Fetch the best-practice pages listed under "### Watched pages"
in docs/AI_NEWS_LOG.md, compare each with the copy kept from the previous run,
and keep the new copy.

A row's third column, when it holds an address pattern (`*` for any text), adds
every link on that page matching it, each checked after the page: a page that
lists other pages, such as one per model, keeps the list current by itself.

One line per page, in table order: `new` (no copy before; stored), `unchanged`,
`changed` (the line names the file its unified diff is kept in) or `failed`
(could not be fetched; the previous copy is kept). The copies and the diffs live
outside the repository. A diff is written to a file rather than printed, so
output cut short, or a second run that finds the page unchanged, cannot lose it.

usage: scripts/watch-pages.py [--log PATH] [--store DIR] [--diffs DIR]
  --log    the news log (default: docs/AI_NEWS_LOG.md in the repo the script sits in)
  --store  where the copies are kept (default: ~/.aide/news-check/watched-pages)
  --diffs  where the diffs are kept (default: watched-diffs beside the store)

Standard library only, and nothing newer than Python 3.9.
"""
import argparse
import difflib
import fnmatch
import re
import subprocess
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urldefrag, urljoin

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
MIN_TEXT = 200
SECTION = "### Watched pages"

DROPPED = {"script", "style", "noscript", "svg", "template", "nav", "header", "footer"}
BLOCKS = {
    "address", "article", "aside", "blockquote", "body", "br", "dd", "details", "div", "dl", "dt", "fieldset",
    "figcaption", "figure", "form", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "main", "ol", "p",
    "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr", "ul",
}


def watched_pages(log_text):
    """The `(tool, address, follow)` rows of the `### Watched pages` section; `follow` is the
    pattern of the page's links to watch as well, or None."""
    rows = []
    inside = False
    for line in log_text.splitlines():
        if line.strip() == SECTION:
            inside = True
            continue
        if not inside:
            continue
        if line.startswith("#") or line.strip() == "---":
            break
        if not line.lstrip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        address = cells[1].strip("<>").strip()
        follow = cells[2].strip("<>").strip() if len(cells) > 2 else ""
        if "://" in address:
            rows.append((cells[0], address, follow if "://" in follow else None))
    return rows


class _Text(HTMLParser):
    """The text of a page as lines; `main` holds only <main>'s lines, when the page has one.
    `code` holds the indexes of the lines written inside a <pre>."""

    def __init__(self):
        super().__init__()
        self.skipping = 0
        self.in_main = 0
        self.in_pre = 0
        self.has_main = False
        self.whole = [""]
        self.main = [""]
        self.code = set()

    def _break(self):
        for lines in (self.whole, self.main):
            lines.append("")

    def handle_starttag(self, tag, attrs):
        if tag in DROPPED:
            self.skipping += 1
        elif tag == "main":
            self.in_main += 1
            self.has_main = True
        elif tag == "pre":
            self.in_pre += 1
        if tag in BLOCKS:
            self._break()

    def handle_endtag(self, tag):
        if tag in DROPPED:
            self.skipping = max(0, self.skipping - 1)
        elif tag == "main":
            self.in_main = max(0, self.in_main - 1)
        elif tag == "pre":
            self.in_pre = max(0, self.in_pre - 1)
        if tag in BLOCKS:
            self._break()

    def handle_data(self, data):
        if self.skipping:
            return
        for number, part in enumerate(data.split("\n") if self.in_pre else [data]):
            if number:
                self._break()
            if self.in_pre:
                self.code.add(len(self.whole) - 1)
            self.whole[-1] += part
            if self.in_main:
                self.main[-1] += part


class _Links(HTMLParser):
    """Every <a href> on a page."""

    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.hrefs.append(href)


def followed_links(html, address, pattern):
    """The page's links that match `pattern`, made absolute, without fragments, sorted, once each."""
    parser = _Links()
    parser.feed(html)
    parser.close()
    found = {urldefrag(urljoin(address, href))[0] for href in parser.hrefs}
    return sorted(link for link in found if link != address and fnmatch.fnmatchcase(link, pattern))


def page_text(html):
    """A page's text, one line per block, empty lines dropped. Whitespace is collapsed, except in a
    code example (<pre>), where each line keeps its indentation."""
    parser = _Text()
    parser.feed(html)
    parser.close()
    lines = parser.main if parser.has_main else parser.whole
    cleaned = (
        line.rstrip() if number in parser.code else re.sub(r"\s+", " ", line).strip()
        for number, line in enumerate(lines)
    )
    return "\n".join(line for line in cleaned if line)


def fetch(address):
    """The page's HTML, or (None, the reason it failed)."""
    try:
        done = subprocess.run(
            ["curl", "-sSfL", "--max-time", "30", "-A", USER_AGENT, address],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as error:
        return None, "curl could not be run: %s" % error
    if done.returncode != 0:
        stderr = done.stderr.decode("utf-8", "replace").strip().splitlines()
        return None, stderr[0] if stderr else "curl exit %d" % done.returncode
    return done.stdout.decode("utf-8", "replace"), None


def copy_path(store, address):
    name = re.sub(r"[^A-Za-z0-9.]+", "-", address.split("://", 1)[-1]).strip("-")
    return Path(store) / (name + ".txt")


def check(address, store, diffs):
    """Fetch, compare and keep one page: (status, detail, html), detail being a reason or the
    diff's file, and html the page as fetched (None when it failed)."""
    html, reason = fetch(address)
    if html is None:
        return "failed", reason, None
    status, detail = compare(address, html, store, diffs)
    return status, detail, html


def compare(address, html, store, diffs):
    """Compare a fetched page with its kept copy and keep the new one: (status, detail)."""
    text = page_text(html)
    if len(text) < MIN_TEXT:
        return "failed", "almost no text on the page"
    path = copy_path(store, address)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
        return "new", ""
    previous = path.read_text(encoding="utf-8").rstrip("\n")
    if previous == text:
        return "unchanged", ""
    diff = difflib.unified_diff(
        previous.splitlines(), text.splitlines(), "previous", "now", n=3, lineterm=""
    )
    kept = Path(diffs) / ("%s.%s.diff" % (path.stem, time.strftime("%Y%m%d-%H%M%S")))
    kept.parent.mkdir(parents=True, exist_ok=True)
    kept.write_text("\n".join(diff) + "\n", encoding="utf-8")
    path.write_text(text + "\n", encoding="utf-8")
    return "changed", str(kept)


def main(argv=None):
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(prog="scripts/watch-pages.py", description=__doc__.split("\n\n")[0])
    parser.add_argument("--log", default=str(here.parent / "docs" / "AI_NEWS_LOG.md"))
    parser.add_argument("--store", default=str(Path.home() / ".aide" / "news-check" / "watched-pages"))
    parser.add_argument("--diffs")
    args = parser.parse_args(argv)
    diffs = args.diffs or str(Path(args.store).parent / "watched-diffs")

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    try:
        rows = watched_pages(Path(args.log).read_text(encoding="utf-8"))
    except OSError as error:
        print("Cannot read the news log: %s" % error, file=sys.stderr)
        return 1
    if not rows:
        print("%s has no '%s' section with a page in it." % (args.log, SECTION), file=sys.stderr)
        return 1

    width = max(len(tool) for tool, _, _ in rows)

    def report(tool, address):
        status, detail, html = check(address, args.store, diffs)
        line = "%-10s %-*s %s" % (status, width, tool, address)
        if status == "failed":
            line += " — " + detail
        elif status == "changed":
            line += " — diff in " + detail
        print(line)
        return html

    for tool, address, follow in rows:
        html = report(tool, address)
        if follow and html is not None:
            for link in followed_links(html, address, follow):
                report(tool, link)
    return 0


if __name__ == "__main__":
    sys.exit(main())
