"""scripts/news/watch-pages.py: fetch the watched pages, compare each with its kept copy, keep the new one."""
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.validation

TOOLS = {"Claude Code", "GitHub Copilot CLI", "OpenAI Codex CLI", "OpenCode", "All four"}

FILLER = (
    "Keep the instructions short and put the details in files the assistant reads when it needs them, "
    "so that every session starts from the same small, predictable context and stays focused on the task."
)


@pytest.fixture
def script(workspace_root):
    return workspace_root / "scripts" / "news" / "watch-pages.py"


@pytest.fixture
def module(script, monkeypatch):
    monkeypatch.syspath_prepend(str(script.parent))
    spec = importlib.util.spec_from_file_location("watch_pages", script)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def page(tmp_path, name, body):
    """Write an HTML file and return its file:// address."""
    folder = tmp_path / "site"
    folder.mkdir(exist_ok=True)
    path = folder / name
    path.write_text(f"<html><head><title>t</title></head><body>{body}</body></html>")
    return f"file://{path}"


def article(*lines):
    return "".join(f"<p>{line}</p>" for line in lines) + f"<p>{FILLER}</p>"


def write_log(tmp_path, pages, follow=None):
    """A news log watching `pages`; `follow` maps a page to the links it is followed to."""
    follow = follow or {}
    rows = "\n".join(
        f"| Claude Code | <{address}> | {('<' + follow[address] + '>') if address in follow else ''} |"
        for address in pages
    )
    log = tmp_path / "logs" / "AI_NEWS_LOG.md"
    log.parent.mkdir(exist_ok=True)
    log.write_text(
        "# News\n\n### Sources\n\n| Tool | Changelog |\n|---|---|\n| Claude Code | <https://x.example/> |\n\n"
        "### Watched pages\n\nSome words.\n\n| Tool | Page | Also its links to |\n|------|------|------|\n"
        f"{rows}\n\n---\n\n## Notation\n"
    )
    return log


def run(script, tmp_path, log, store=None, home=None):
    env = {"PATH": "/usr/bin:/bin", "HOME": str(home or tmp_path / "home")}
    command = [sys.executable, str(script), "--log", str(log)]
    if store is not None:
        command += ["--store", str(store)]
    return subprocess.run(command, capture_output=True, text=True, env=env)


def lines_for(output, address):
    return [line for line in output.splitlines() if address in line]


def run_after_a_change(script, tmp_path, before, after):
    """Runs the script once on a page carrying `before`, then again once
    the page carries `after`, and returns the second run."""
    address = page(tmp_path, "p.html", before)
    store = tmp_path / "store"
    log = write_log(tmp_path, [address])
    run(script, tmp_path, log, store)
    page(tmp_path, "p.html", after)
    return run(script, tmp_path, log, store)


def test_watched_pages_use_shared_cells_but_keep_their_row_rules_ac_2_ac_3(module, monkeypatch):
    monkeypatch.setattr(module.news, "section_cells", lambda *args, **kwargs: iter([
        ["Missing address"],
        ["Aide", "<https://a.example/>", "<https://a.example/docs/*>"],
        ["Aide", "not-an-address", ""],
    ]))

    assert module.watched_pages("not the real table") == [
        ("Aide", "https://a.example/", "https://a.example/docs/*")
    ]


def test_watched_pages_stop_at_headings_and_separators_and_accept_empty_input_ac_2_ac_3_ac_4_ac_8(module):
    before_separator = """### Watched pages
| Tool | Page | Follow |
|---|---|---|
| malformed |
| Aide | <https://before.example/> | invalid |
---
| Aide | <https://outside.example/> | |
"""
    before_heading = """### Watched pages
| Aide | <https://before.example/> |
## Notation
| Aide | <https://outside.example/> |
"""

    assert module.watched_pages(before_separator) == [("Aide", "https://before.example/", None)]
    assert module.watched_pages(before_heading) == [("Aide", "https://before.example/", None)]
    assert module.watched_pages("") == []


def test_the_repo_s_table_names_a_tool_and_an_address_on_every_row(module, workspace_root):
    text = (workspace_root / "docs" / "AI_NEWS_LOG.md").read_text()
    rows = module.watched_pages(text)
    assert rows
    for tool, address, follow in rows:
        assert tool in TOOLS
        assert address.startswith("https://")
        assert follow is None or follow.startswith("https://")
    addresses = [address for _, address, _ in rows]
    assert len(addresses) == len(set(addresses))


def test_every_page_in_the_table_gets_a_line_in_table_order(script, tmp_path):
    first = page(tmp_path, "first.html", article("First page."))
    second = page(tmp_path, "second.html", article("Second page."))
    store = tmp_path / "store"
    log = write_log(tmp_path, [first, second])
    assert run(script, tmp_path, log, store).returncode == 0

    result = run(script, tmp_path, log, store)
    assert result.returncode == 0
    statuses = [line.split()[0] for line in result.stdout.splitlines()]
    assert statuses == ["unchanged", "unchanged"]
    assert result.stdout.index(first) < result.stdout.index(second)


def diff_file(line):
    """The file a `changed` line names its diff in."""
    return Path(line.rsplit(" in ", 1)[1].strip())


def test_a_changed_page_keeps_its_diff_in_a_file_and_keeps_the_new_copy(script, tmp_path):
    address = page(tmp_path, "p.html", article("Remove this advice.", "Stay as it was."))
    store = tmp_path / "store"
    log = write_log(tmp_path, [address])
    run(script, tmp_path, log, store)

    page(tmp_path, "p.html", article("Add this advice.", "Stay as it was."))
    result = run(script, tmp_path, log, store)

    assert result.returncode == 0
    assert result.stdout.startswith("changed")
    diff = diff_file(result.stdout.splitlines()[0]).read_text()
    assert "-Remove this advice." in diff
    assert "+Add this advice." in diff
    kept = [p.read_text() for p in store.iterdir()]
    assert len(kept) == 1 and "Add this advice." in kept[0] and "Remove this advice." not in kept[0]

    again = run(script, tmp_path, log, store)
    assert again.stdout.startswith("unchanged")


def test_a_diff_cut_from_the_output_is_still_there_after_a_second_run(script, tmp_path):
    address = page(tmp_path, "p.html", article("Old advice."))
    store = tmp_path / "store"
    log = write_log(tmp_path, [address])
    run(script, tmp_path, log, store)

    page(tmp_path, "p.html", article("New advice."))
    first = run(script, tmp_path, log, store)
    run(script, tmp_path, log, store)

    assert "@@" not in first.stdout
    assert "+New advice." in diff_file(first.stdout.splitlines()[0]).read_text()


def test_a_page_s_links_matching_its_pattern_are_watched_after_it(script, tmp_path):
    first = page(tmp_path, "model-one.html", article("Model one advice."))
    page(tmp_path, "model-two.html", article("Model two advice."))
    page(tmp_path, "other.html", article("Not a model page."))
    overview = page(
        tmp_path, "overview.html",
        article("Overview.") + '<a href="model-two.html">2</a><a href="model-one.html#top">1</a>'
        '<a href="other.html">x</a><a href="model-one.html">1 again</a>',
    )
    store = tmp_path / "store"
    log = write_log(tmp_path, [overview], {overview: first.rsplit("/", 1)[0] + "/model-*"})

    result = run(script, tmp_path, log, store)

    lines = result.stdout.splitlines()
    assert [line.split()[0] for line in lines] == ["new", "new", "new"]
    assert overview in lines[0] and "model-one.html" in lines[1] and "model-two.html" in lines[2]
    assert "other.html" not in result.stdout


def test_a_followed_page_that_changes_keeps_its_diff(script, tmp_path):
    model = page(tmp_path, "model-one.html", article("Old model advice."))
    overview = page(tmp_path, "overview.html", article("Overview.") + '<a href="model-one.html">1</a>')
    store = tmp_path / "store"
    log = write_log(tmp_path, [overview], {overview: model.rsplit("/", 1)[0] + "/model-*"})
    run(script, tmp_path, log, store)

    page(tmp_path, "model-one.html", article("New model advice."))
    result = run(script, tmp_path, log, store)

    line = lines_for(result.stdout, "model-one.html")[0]
    assert line.startswith("changed")
    assert "+New model advice." in diff_file(line).read_text()


def test_a_change_inside_nav_header_or_footer_is_unchanged(script, tmp_path):
    def body(menu):
        return (
            f"<header>Header {menu}</header><nav>Menu {menu}</nav>{article('The advice stays.')}"
            f"<footer>Footer {menu}</footer>"
        )

    result = run_after_a_change(script, tmp_path, body("one"), body("two"))

    assert result.stdout.startswith("unchanged")
    assert "@@" not in result.stdout


CODE_MARKUPS = {
    "newlines": (
        '<pre><code><span class="line">metadata:</span>\n<span class="line">  author: x</span>\n'
        '<span class="line">  model: opus</span></code></pre>'
    ),
    "one-div-per-line": (
        '<pre><code><div class="ec-line"><div class="code">metadata:</div></div>'
        '<div class="ec-line"><div class="code"><span class="indent">  </span>author: x</div></div>'
        '<div class="ec-line"><div class="code"><span class="indent">  </span>model: opus</div></div></code></pre>'
    ),
}


@pytest.mark.parametrize("markup", CODE_MARKUPS)
def test_a_code_example_keeps_its_line_breaks_and_indentation_ac_1(module, markup):
    html = f"<main><p>Spaced   out\n   words</p>{CODE_MARKUPS[markup]}</main>"

    text = module.page_text(html)

    assert text.splitlines() == ["Spaced out words", "metadata:", "  author: x", "  model: opus"]


def test_the_text_inside_an_aside_stands_on_a_line_of_its_own_ac_2(module):
    html = "<main><div>Keep skills short.<aside>Prefer one skill per task.</aside></div></main>"

    assert module.page_text(html).splitlines() == ["Keep skills short.", "Prefer one skill per task."]


def test_a_side_column_outside_main_stays_out_of_the_text(module):
    html = "<aside>On this page</aside><main><p>The advice.</p></main>"

    assert module.page_text(html) == "The advice."


def test_a_code_example_whose_indentation_alone_changes_is_changed_ac_3(script, tmp_path):
    def body(model_line):
        example = f"<pre><code>metadata:\n  author: x\n{model_line}</code></pre>"
        return f"<main>{example}{article('The advice stays.')}</main>"

    result = run_after_a_change(script, tmp_path, body("model: opus"), body("  model: opus"))

    assert result.stdout.startswith("changed")
    diff = diff_file(result.stdout.splitlines()[0]).read_text()
    assert "-model: opus" in diff
    assert "+  model: opus" in diff


def test_a_change_only_inside_an_aside_is_changed_ac_4(script, tmp_path):
    def body(tip):
        return f"<main>{article('The advice stays.')}<aside>{tip}</aside></main>"

    result = run_after_a_change(script, tmp_path, body("Prefer one skill per task."), body("Prefer several skills per task."))

    assert result.stdout.startswith("changed")
    diff = diff_file(result.stdout.splitlines()[0]).read_text()
    assert "-Prefer one skill per task." in diff
    assert "+Prefer several skills per task." in diff


def test_only_main_s_text_is_compared_when_the_page_has_one(script, tmp_path):
    def body(outside):
        return f"<p>Outside {outside}</p><main>{article('Inside stays.')}</main><p>After {outside}</p>"

    result = run_after_a_change(script, tmp_path, body("one"), body("two"))

    assert result.stdout.startswith("unchanged")
    assert "@@" not in result.stdout


def test_a_page_with_no_copy_is_stored_and_prints_no_diff(script, tmp_path):
    address = page(tmp_path, "p.html", article("Fresh page."))
    store = tmp_path / "store"
    log = write_log(tmp_path, [address])

    result = run(script, tmp_path, log, store)

    assert result.returncode == 0
    assert result.stdout.startswith("new")
    assert "@@" not in result.stdout
    assert len(list(store.iterdir())) == 1


def test_a_page_that_cannot_be_fetched_keeps_its_copy(script, tmp_path):
    address = page(tmp_path, "p.html", article("Here today."))
    store = tmp_path / "store"
    log = write_log(tmp_path, [address])
    run(script, tmp_path, log, store)
    copy = next(store.iterdir())
    before = copy.read_bytes()

    (tmp_path / "site" / "p.html").unlink()
    result = run(script, tmp_path, log, store)

    assert result.returncode == 0
    line = lines_for(result.stdout, address)[0]
    assert line.startswith("failed")
    assert "curl" in line
    assert copy.read_bytes() == before


def test_a_page_with_almost_no_text_counts_as_failed(script, tmp_path):
    address = page(tmp_path, "p.html", article("Good page."))
    store = tmp_path / "store"
    log = write_log(tmp_path, [address])
    run(script, tmp_path, log, store)
    copy = next(store.iterdir())
    before = copy.read_bytes()

    page(tmp_path, "p.html", "<p>Please enable JavaScript.</p>")
    result = run(script, tmp_path, log, store)

    line = lines_for(result.stdout, address)[0]
    assert line.startswith("failed")
    assert "almost no text on the page" in line
    assert copy.read_bytes() == before


def test_the_copies_are_kept_under_home_by_default(script, tmp_path):
    address = page(tmp_path, "p.html", article("Kept elsewhere."))
    log = write_log(tmp_path, [address])
    home = tmp_path / "home"
    home.mkdir()
    before = sorted(p.name for p in log.parent.iterdir())

    result = run(script, tmp_path, log, home=home)

    assert result.returncode == 0
    kept = list((home / ".aide" / "news-check" / "watched-pages").iterdir())
    assert len(kept) == 1
    assert sorted(p.name for p in log.parent.iterdir()) == before


@pytest.mark.parametrize("log_text", ["# News\n\n### Sources\n\nNothing.\n", "### Watched pages\n\n| Tool | Page |\n|---|---|\n"])
def test_a_log_with_no_watched_pages_or_an_empty_table_exits_1(script, tmp_path, log_text):
    log = tmp_path / "AI_NEWS_LOG.md"
    log.write_text(log_text)

    result = run(script, tmp_path, log, tmp_path / "store")

    assert result.returncode == 1
    assert result.stderr.strip()
    assert os.path.exists(tmp_path / "store") is False or not list((tmp_path / "store").iterdir())


def test_without_log_the_repository_s_news_log_is_read(module, workspace_root, tmp_path, monkeypatch):
    fetched = []
    html = "<html><body><p>%s</p></body></html>" % FILLER
    monkeypatch.setattr(module, "fetch", lambda address: (fetched.append(address), (html, None))[1])
    assert module.main(["--store", str(tmp_path / "store")]) == 0
    rows = module.watched_pages((workspace_root / "docs" / "AI_NEWS_LOG.md").read_text(encoding="utf-8"))
    assert rows and fetched == [address for _, address, _ in rows]
