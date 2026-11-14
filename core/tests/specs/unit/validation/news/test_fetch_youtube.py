"""scripts/news/fetch-youtube.py: list the followed channels' new videos, and read the captions of a few."""
import importlib.util
import json
import re
import sys
from xml.sax.saxutils import escape

import pytest

pytestmark = pytest.mark.validation

FEED = "https://www.youtube.com/feeds/videos.xml?channel_id=%s"
CHANNEL_ID = re.compile(r"UC[A-Za-z0-9_-]{22}")


@pytest.fixture
def module(workspace_root):
    script = workspace_root / "scripts" / "news" / "fetch-youtube.py"
    spec = importlib.util.spec_from_file_location("fetch_youtube", script)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def feed(*entries):
    """An Atom feed as a channel's feed gives it; each entry is (id, title, description, published)."""
    parts = []
    for video, title, description, published in entries:
        parts.append(
            f"<entry><id>yt:video:{video}</id><yt:videoId>{video}</yt:videoId>"
            f"<title>{escape(title)}</title>"
            f'<link rel="alternate" href="https://www.youtube.com/watch?v={video}"/>'
            f"<published>{published}</published><updated>{published}</updated>"
            f"<media:group><media:title>{escape(title)}</media:title>"
            f"<media:description>{escape(description)}</media:description></media:group></entry>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" '
        'xmlns="http://www.w3.org/2005/Atom"><title>A channel</title>' + "".join(parts) + "</feed>"
    )


LOG = """# AI news log

### Sources

| Tool | News |
|------|------|
| Claude Code | <https://claude.com/blog/> |

### YouTube channels

The channels the news check follows.

| Channel        | Channel id               |
|----------------|--------------------------|
| AI Engineer    | UCLKPca3kwwd-B59HNr-_lvA |
| Code with Beto | UCh247h68vszOMA_OWpGEa5g |

### Watched pages

| Tool | Page |
|------|------|
| Claude Code | <https://code.claude.com/docs/en/best-practices> |
"""


def test_the_channels_are_the_rows_of_the_youtube_channels_table_in_order_ac_1(module):
    assert module.channels(LOG) == [
        ("AI Engineer", "UCLKPca3kwwd-B59HNr-_lvA"),
        ("Code with Beto", "UCh247h68vszOMA_OWpGEa5g"),
    ]


def test_the_repository_s_news_log_follows_channels_each_with_a_channel_id_ac_1(module, workspace_root):
    rows = module.channels((workspace_root / "docs" / "AI_NEWS_LOG.md").read_text(encoding="utf-8"))
    assert rows
    assert all(CHANNEL_ID.fullmatch(channel_id) for _, channel_id in rows)
    assert len({channel_id for _, channel_id in rows}) == len(rows)


def test_without_log_the_videos_command_reads_the_repository_s_news_log_ac_1(module, workspace_root, tmp_path, monkeypatch):
    monkeypatch.setattr(module.watch_pages, "fetch", lambda address: (feed(), None))
    output = tmp_path / "videos.json"
    assert module.main(["videos", "--since", "2026-11-13", "--output", str(output)]) == 0
    listed = [c["channel_id"] for c in json.loads(output.read_text())["channels"]]
    log = (workspace_root / "docs" / "AI_NEWS_LOG.md").read_text(encoding="utf-8")
    assert listed == [channel_id for _, channel_id in module.channels(log)]


def test_the_videos_since_the_date_are_listed_newest_first_with_title_description_date_and_link_ac_2(module):
    xml = feed(
        ("new", "Claude Code hooks & you", "A talk on hooks.", "2026-11-14T09:00:00+00:00"),
        ("mid", "Codex in practice", "Walkthrough.", "2026-11-13T00:00:00+00:00"),
        ("old", "Last week", "Older.", "2026-11-12T23:59:59+00:00"),
    )
    videos, more = module.feed_videos(xml, "2026-11-13")
    assert videos == [
        {"id": "new", "title": "Claude Code hooks & you", "description": "A talk on hooks.",
         "published": "2026-11-14T09:00:00+00:00", "link": "https://www.youtube.com/watch?v=new"},
        {"id": "mid", "title": "Codex in practice", "description": "Walkthrough.",
         "published": "2026-11-13T00:00:00+00:00", "link": "https://www.youtube.com/watch?v=mid"},
    ]
    assert more is False


def test_a_full_feed_all_since_the_date_says_more_videos_may_exist_ac_2(module):
    full = [(f"v{n}", "t", "d", "2026-11-14T00:00:00+00:00") for n in range(15)]
    assert module.feed_videos(feed(*full), "2026-11-13")[1] is True
    assert module.feed_videos(feed(*full[:14]), "2026-11-13")[1] is False
    with_an_old_one = full[:14] + [("old", "t", "d", "2026-11-01T00:00:00+00:00")]
    assert module.feed_videos(feed(*with_an_old_one), "2026-11-13")[1] is False


def write_log(tmp_path, rows):
    log = tmp_path / "AI_NEWS_LOG.md"
    log.write_text(
        "### YouTube channels\n\n| Channel | Channel id |\n|---|---|\n"
        + "".join(f"| {name} | {channel_id} |\n" for name, channel_id in rows)
        + "\n---\n"
    )
    return log


def run_videos(module, tmp_path, rows, answers, capsys, monkeypatch):
    """Run `videos` with each feed address answered from `answers`; returns (exit, report, lines)."""
    monkeypatch.setattr(module.watch_pages, "fetch", lambda address: answers[address])
    output = tmp_path / "videos.json"
    code = module.main(["videos", "--since", "2026-11-13", "--log", str(write_log(tmp_path, rows)),
                        "--output", str(output)])
    return code, json.loads(output.read_text()), capsys.readouterr().out.splitlines()


A = ("AI Engineer", "UCLKPca3kwwd-B59HNr-_lvA")
B = ("Code with Beto", "UCh247h68vszOMA_OWpGEa5g")
C = ("Convex", "UCoC_9mdiPwIu1sDxDtGQggQ")


def test_the_videos_command_lists_every_channel_s_videos_and_a_line_each_ac_2(module, tmp_path, capsys, monkeypatch):
    answers = {
        FEED % A[1]: (feed(("a1", "Claude Code", "d", "2026-11-14T00:00:00+00:00")), None),
        FEED % B[1]: (feed(("b1", "Codex", "d", "2026-11-13T10:00:00+00:00"),
                           ("b0", "Old", "d", "2026-11-01T10:00:00+00:00")), None),
    }
    code, report, lines = run_videos(module, tmp_path, [A, B], answers, capsys, monkeypatch)
    assert code == 0
    assert report["since"] == "2026-11-13"
    assert [(c["channel"], [v["id"] for v in c["videos"]]) for c in report["channels"]] == [
        ("AI Engineer", ["a1"]), ("Code with Beto", ["b1"])]
    assert [line.split()[:2] for line in lines] == [["listed", "1"], ["listed", "1"]]


def test_a_channel_that_cannot_be_read_is_named_and_the_others_are_still_listed_ac_6(module, tmp_path, capsys, monkeypatch):
    answers = {
        FEED % A[1]: (None, "curl: (22) The requested URL returned error: 404"),
        FEED % B[1]: ("<html>not a feed", None),
        FEED % C[1]: (feed(("c1", "OpenCode", "d", "2026-11-14T00:00:00+00:00")), None),
    }
    code, report, lines = run_videos(module, tmp_path, [A, B, C], answers, capsys, monkeypatch)
    assert code == 1
    first, second, third = report["channels"]
    assert "404" in first["error"] and "videos" not in first
    assert second["error"] and "videos" not in second
    assert [v["id"] for v in third["videos"]] == ["c1"]
    assert lines[0].startswith("failed") and "404" in lines[0]
    assert lines[1].startswith("failed")
    assert lines[2].startswith("listed")


def test_a_channel_whose_feed_may_hold_more_says_so_on_its_line_ac_2(module, tmp_path, capsys, monkeypatch):
    full = [(f"v{n}", "t", "d", "2026-11-14T00:00:00+00:00") for n in range(15)]
    code, report, lines = run_videos(module, tmp_path, [A], {FEED % A[1]: (feed(*full), None)}, capsys, monkeypatch)
    assert report["channels"][0]["more_may_exist"] is True
    assert "more may exist" in lines[0]


def test_a_log_with_no_channel_exits_1(module, tmp_path, capsys):
    code = module.main(["videos", "--since", "2026-11-13", "--log", str(write_log(tmp_path, [])),
                        "--output", str(tmp_path / "videos.json")])
    assert code == 1
    assert capsys.readouterr().err.strip()


AUTO_VTT = """WEBVTT
Kind: captions
Language: en

STYLE
::cue { color: white }

00:00:00.160 --> 00:00:02.869 align:start position:0%

hello<00:00:00.480><c> and</c><00:00:00.640><c> welcome</c>

00:00:02.869 --> 00:00:02.879 align:start position:0%
hello and welcome


00:00:02.879 --> 00:00:05.110 align:start position:0%
hello and welcome
today<00:00:03.200><c> we</c><00:00:03.360><c> talk</c><c> Q&amp;A</c>

00:00:05.110 --> 00:00:05.120 align:start position:0%
today we talk Q&amp;A

"""


@pytest.fixture
def yt_dlp(tmp_path, monkeypatch):
    """A fake yt-dlp first on PATH. By the video id's start: `fail` exits 1, `potoken` warns and writes
    nothing, `none` writes nothing, anything else writes automatic English captions. Each call is logged."""
    folder = tmp_path / "bin"
    folder.mkdir()
    calls = tmp_path / "yt-dlp-calls.txt"
    vtt = tmp_path / "auto.vtt"
    vtt.write_text(AUTO_VTT)
    fake = folder / "yt-dlp"
    fake.write_text(f"""#!{sys.executable}
import pathlib, sys
args = sys.argv[1:]
with open({str(calls)!r}, "a") as log:
    log.write(" ".join(args) + "\\n")
folder = pathlib.Path(args[args.index("--paths") + 1])
video = args[args.index("--") + 1].split("v=")[-1]
if video.startswith("fail"):
    sys.stderr.write("ERROR: [youtube] %s: Video unavailable. This video has been removed\\n" % video)
    sys.exit(1)
if video.startswith("potoken"):
    sys.stderr.write("WARNING: [youtube] %s: Some web client subtitles require a PO Token which was not provided. "
                     "They will be discarded\\n" % video)
    sys.exit(0)
if video.startswith("none"):
    print("[info] %s: There are no subtitles for the requested languages" % video)
    sys.exit(0)
(folder / (video + ".en.vtt")).write_text(open({str(vtt)!r}).read())
""")
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", f"{folder}:/usr/bin:/bin")
    return calls


def link(video):
    return "https://www.youtube.com/watch?v=" + video


def run_captions(module, tmp_path, capsys, *videos):
    out = tmp_path / "captions"
    code = module.main(["captions", "--out", str(out), *(link(v) for v in videos)])
    return code, out, capsys.readouterr().out.splitlines()


def test_more_than_five_links_are_refused_before_yt_dlp_runs_ac_3(module, tmp_path, yt_dlp):
    with pytest.raises(SystemExit) as refused:
        module.main(["captions", "--out", str(tmp_path / "c"), *(link(f"none{n}") for n in range(6))])
    assert refused.value.code == 2
    assert not yt_dlp.exists()


def test_five_links_run_yt_dlp_once_each_ac_3(module, tmp_path, capsys, yt_dlp):
    code, _, lines = run_captions(module, tmp_path, capsys, *(f"none{n}" for n in range(5)))
    assert code == 0
    assert len(yt_dlp.read_text().splitlines()) == 5
    assert len(lines) == 5


def test_automatic_captions_are_written_as_each_spoken_line_once_ac_3(module, tmp_path, capsys, yt_dlp):
    code, out, lines = run_captions(module, tmp_path, capsys, "abc123")
    assert code == 0
    assert lines == ["captions %s %s" % (link("abc123"), out / "abc123.txt")]
    assert (out / "abc123.txt").read_text() == "hello and welcome\ntoday we talk Q&A\n"


def test_a_video_without_captions_is_none_and_not_a_failure_ac_5(module, tmp_path, capsys, yt_dlp):
    code, _, lines = run_captions(module, tmp_path, capsys, "none1")
    assert code == 0
    assert lines == ["none " + link("none1")]


def test_a_caption_that_cannot_be_read_is_named_and_the_others_still_fetched_ac_6(module, tmp_path, capsys, yt_dlp):
    code, out, lines = run_captions(module, tmp_path, capsys, "first", "fail1", "third")
    assert code == 1
    assert lines[0].startswith("captions " + link("first"))
    assert lines[1].startswith("failed " + link("fail1")) and "Video unavailable" in lines[1]
    assert lines[2].startswith("captions " + link("third"))
    assert (out / "third.txt").exists()


def test_captions_left_out_for_want_of_a_po_token_are_a_failure_not_none_ac_6(module, tmp_path, capsys, yt_dlp):
    code, _, lines = run_captions(module, tmp_path, capsys, "potoken1")
    assert code == 1
    assert lines[0].startswith("failed " + link("potoken1")) and "PO Token" in lines[0]


def test_without_yt_dlp_every_link_fails_saying_it_could_not_run_ac_6(module, tmp_path, capsys, monkeypatch):
    empty = tmp_path / "empty"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))
    code, _, lines = run_captions(module, tmp_path, capsys, "a1", "a2")
    assert code == 1
    assert [line.split()[:2] for line in lines] == [["failed", link("a1")], ["failed", link("a2")]]
    assert all("could not be run" in line for line in lines)


def test_the_installer_declares_the_command_the_script_runs_ac_7(module, workspace_root):
    text = (workspace_root / "core" / "scripts" / "_install-bin.sh").read_text()
    declared = re.search(r'^MISE_DECLARED_TOOLS="([^"]*)"', text, re.MULTILINE).group(1).split()
    assert module.YT_DLP in declared


def test_a_channel_answering_a_page_that_is_not_a_feed_is_named_as_a_gap_ac_6(module, tmp_path, capsys, monkeypatch):
    answers = {FEED % A[1]: ("<html><body>Temporarily unavailable</body></html>", None)}
    code, report, lines = run_videos(module, tmp_path, [A], answers, capsys, monkeypatch)
    assert code == 1
    assert report["channels"][0]["error"] and "videos" not in report["channels"][0]
    assert lines[0].startswith("failed")
