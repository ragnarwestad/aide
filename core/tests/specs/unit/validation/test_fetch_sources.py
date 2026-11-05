"""scripts/fetch-sources.py: fetch every news source as its own text, never a summary of it."""
import importlib.util
import json
import subprocess
import sys

import pytest

pytestmark = pytest.mark.validation


@pytest.fixture
def script(workspace_root):
    return workspace_root / "scripts" / "fetch-sources.py"


@pytest.fixture
def module(script):
    spec = importlib.util.spec_from_file_location("fetch_sources", script)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


LOG = """# AI news log

### Sources

Intro text.

| Tool        | Changelog                                         | News                                           |
|-------------|---------------------------------------------------|------------------------------------------------|
| Claude Code | <https://github.com/anthropics/claude-code/releases> | <https://claude.com/blog/><br><https://www.anthropic.com/news> |
| OpenCode    | <https://github.com/anomalyco/opencode/releases><br><https://opencode.ai/changelog> | — |

### Watched pages

| Tool | Page |
|------|------|
| Claude Code | <https://code.claude.com/docs/en/best-practices> |
"""


def test_every_address_in_the_sources_table_is_a_source_and_nothing_below_it(module):
    assert module.sources(LOG) == [
        ("Claude Code", "https://github.com/anthropics/claude-code/releases"),
        ("Claude Code", "https://claude.com/blog/"),
        ("Claude Code", "https://www.anthropic.com/news"),
        ("OpenCode", "https://github.com/anomalyco/opencode/releases"),
        ("OpenCode", "https://opencode.ai/changelog"),
    ]


def test_a_github_releases_page_is_read_from_the_api_and_any_other_page_is_not(module):
    assert module.releases_api("https://github.com/openai/codex/releases") == (
        "https://api.github.com/repos/openai/codex/releases?per_page=20"
    )
    assert module.releases_api("https://opencode.ai/changelog") is None
    assert module.releases_api("https://github.com/openai/codex") is None


def test_a_fetch_that_fails_once_is_tried_again(module, monkeypatch):
    answers = [(None, "curl: (92) HTTP/2 stream 1 was not closed cleanly"), ("<p>Nov 5 notes</p>", None)]
    monkeypatch.setattr(module.watch_pages, "fetch", lambda address: answers.pop(0))
    assert module.fetch_text("https://opencode.ai/changelog", None) == ("Nov 5 notes", None)


def test_every_release_since_the_date_keeps_its_whole_notes_and_older_ones_are_left_out(module):
    long_notes = "\n".join(f"- change {n}" for n in range(400))
    releases = json.dumps([
        {"tag_name": "v2.1.318", "published_at": "2026-11-04T18:00:00Z", "prerelease": False, "body": long_notes},
        {"tag_name": "v2.1.317", "published_at": "2026-11-03T09:00:00Z", "prerelease": True, "body": "- fix"},
        {"tag_name": "v2.1.316", "published_at": "2026-11-02T23:59:59Z", "prerelease": False, "body": "- old"},
    ])
    text = module.releases_text(releases, since="2026-11-03")
    assert "v2.1.318" in text and "- change 399" in text
    assert "v2.1.317 (pre-release)" in text
    assert "v2.1.316" not in text


def test_a_full_page_of_releases_all_since_the_date_says_older_ones_may_be_missing(module):
    page = json.dumps([
        {"tag_name": f"v0.{n}", "published_at": "2026-11-05T00:00:00Z", "prerelease": True, "body": ""}
        for n in range(module.PAGE_SIZE)
    ])
    assert "more releases" in module.releases_text(page, since="2026-11-01")
    assert "more releases" not in module.releases_text(json.dumps(json.loads(page)[:3]), since="2026-11-01")


def test_a_page_is_written_as_its_text_and_a_failed_fetch_is_named(script, tmp_path):
    page = tmp_path / "news.html"
    page.write_text("<html><body><script>x()</script><main><h2>Nov 5</h2><p>New hooks event</p></main></body></html>")
    log = tmp_path / "log.md"
    log.write_text(
        "### Sources\n\n| Tool | News |\n|---|---|\n"
        f"| OpenCode | <file://{page}><br><file://{tmp_path}/missing.html> |\n\n### Watched pages\n"
    )
    out = tmp_path / "out"
    done = subprocess.run(
        [sys.executable, str(script), "--log", str(log), "--out", str(out)],
        capture_output=True, text=True,
    )
    lines = done.stdout.splitlines()
    assert lines[0].startswith("fetched") and lines[0].split()[-1].startswith(str(out))
    assert lines[1].startswith("failed")
    written = (out / lines[0].split()[-1].split("/")[-1]).read_text()
    assert "Nov 5\nNew hooks event" in written and "x()" not in written
    assert done.returncode == 1
