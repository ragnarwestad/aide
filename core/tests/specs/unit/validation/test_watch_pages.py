"""scripts/watch-pages.py: fetch the watched pages, compare each with its kept copy, keep the new one."""
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
    return workspace_root / "scripts" / "watch-pages.py"


@pytest.fixture
def module(script):
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


def write_log(tmp_path, pages):
    rows = "\n".join(f"| Claude Code | <{address}> |" for address in pages)
    log = tmp_path / "logs" / "AI_NEWS_LOG.md"
    log.parent.mkdir(exist_ok=True)
    log.write_text(
        "# News\n\n### Sources\n\n| Tool | Changelog |\n|---|---|\n| Claude Code | <https://x.example/> |\n\n"
        f"### Watched pages\n\nSome words.\n\n| Tool | Page |\n|------|------|\n{rows}\n\n---\n\n## Notation\n"
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


def test_the_repo_s_table_names_a_tool_and_an_address_on_every_row_ac_1(module, workspace_root):
    text = (workspace_root / "docs" / "AI_NEWS_LOG.md").read_text()
    rows = module.watched_pages(text)
    assert rows
    for tool, address in rows:
        assert tool in TOOLS
        assert address.startswith("https://")
    addresses = [address for _, address in rows]
    assert len(addresses) == len(set(addresses))


def test_every_page_in_the_table_gets_a_line_in_table_order_ac_2(script, tmp_path):
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


def test_a_changed_page_keeps_its_diff_in_a_file_and_keeps_the_new_copy_ac_3(script, tmp_path):
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


def test_a_change_inside_nav_header_footer_or_aside_is_unchanged_ac_4(script, tmp_path):
    def body(menu):
        return (
            f"<header>Header {menu}</header><nav>Menu {menu}</nav>{article('The advice stays.')}"
            f"<aside>Side {menu}</aside><footer>Footer {menu}</footer>"
        )

    address = page(tmp_path, "p.html", body("one"))
    store = tmp_path / "store"
    log = write_log(tmp_path, [address])
    run(script, tmp_path, log, store)

    page(tmp_path, "p.html", body("two"))
    result = run(script, tmp_path, log, store)

    assert result.stdout.startswith("unchanged")
    assert "@@" not in result.stdout


def test_only_main_s_text_is_compared_when_the_page_has_one_ac_4(script, tmp_path):
    def body(outside):
        return f"<p>Outside {outside}</p><main>{article('Inside stays.')}</main><p>After {outside}</p>"

    address = page(tmp_path, "p.html", body("one"))
    store = tmp_path / "store"
    log = write_log(tmp_path, [address])
    run(script, tmp_path, log, store)

    page(tmp_path, "p.html", body("two"))
    result = run(script, tmp_path, log, store)

    assert result.stdout.startswith("unchanged")
    assert "@@" not in result.stdout


def test_a_page_with_no_copy_is_stored_and_prints_no_diff_ac_5(script, tmp_path):
    address = page(tmp_path, "p.html", article("Fresh page."))
    store = tmp_path / "store"
    log = write_log(tmp_path, [address])

    result = run(script, tmp_path, log, store)

    assert result.returncode == 0
    assert result.stdout.startswith("new")
    assert "@@" not in result.stdout
    assert len(list(store.iterdir())) == 1


def test_a_page_that_cannot_be_fetched_keeps_its_copy_ac_6(script, tmp_path):
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


def test_a_page_with_almost_no_text_counts_as_failed_ac_6(script, tmp_path):
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


def test_the_copies_are_kept_under_home_by_default_ac_7(script, tmp_path):
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
