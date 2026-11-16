"""Shared fetching, page-text and Markdown-table utilities for the news commands."""
import re
import subprocess
from html.parser import HTMLParser

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

DROPPED = {"script", "style", "noscript", "svg", "template", "nav", "header", "footer"}
BLOCKS = {
    "address", "article", "aside", "blockquote", "body", "br", "dd", "details", "div", "dl", "dt", "fieldset",
    "figcaption", "figure", "form", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "main", "ol", "p",
    "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr", "ul",
}


def section_cells(log_text, section, stop_at_separator=False):
    """Stripped cells from pipe rows in `section`, up to its next boundary."""
    inside = False
    for line in log_text.splitlines():
        if line.strip() == section:
            inside = True
            continue
        if not inside:
            continue
        if line.startswith("#") or stop_at_separator and line.strip() == "---":
            break
        if line.lstrip().startswith("|"):
            yield [cell.strip() for cell in line.strip().strip("|").split("|")]


class _Text(HTMLParser):
    """The text of a page as lines, with main and preformatted text tracked."""

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


def page_text(html):
    """A page's text, one line per block, preserving code indentation."""
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
