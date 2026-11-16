#!/usr/bin/env python3
"""fetch-youtube - List the new videos of the channels in the "### YouTube channels" table
of docs/AI_NEWS_LOG.md, and fetch the English captions of a few of them as plain text.

`videos` reads each channel's feed, which holds its newest 15 videos, and writes the
ones published on or after --since to one JSON file, each with its title, description,
date and link. One line per channel, in table order: `listed <count> <channel> <feed>`,
ending with a note when the feed may hold only part of the period, or
`failed <channel> <feed> <reason>`. Exits 1 when any channel failed.

`captions` runs yt-dlp for at most five links and writes each video's English
captions, automatic ones included, to `<out>/<id>.txt`. One line per link:
`captions <link> <file>`, `none <link>` (the video has no English captions) or
`failed <link> <reason>` (the captions could not be read). Exits 1 when any link failed.

usage: scripts/news/fetch-youtube.py videos --since YYYY-MM-DD [--log PATH] [--output FILE]
       scripts/news/fetch-youtube.py captions [--out DIR] LINK [LINK ...]
  --log     the news log (default: docs/AI_NEWS_LOG.md in the repo the script sits in)
  --output  the JSON file (default: ~/.aide/news-check/youtube-videos.json)
  --out     where the captions are written (default: ~/.aide/news-check/youtube-captions)

Standard library only, and nothing newer than Python 3.9.
"""
import argparse
import html
import json
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ElementTree
from pathlib import Path

import news

SECTION = "### YouTube channels"
FEED = "https://www.youtube.com/feeds/videos.xml?channel_id=%s"
FEED_SIZE = 15
MAX_CAPTIONS = 5
YT_DLP = "yt-dlp"
TIME_LIMIT = 60
CHANNEL_ID = re.compile(r"UC[A-Za-z0-9_-]{22}")
# yt-dlp leaves captions out with a warning, and exits 0, when YouTube asks for what it lacks.
LEFT_OUT = re.compile(r"PO token|JavaScript runtime", re.IGNORECASE)
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}
HERE = Path(__file__).resolve().parent


def channels(log_text):
    """The `(channel, channel id)` rows of the `### YouTube channels` table, in table order."""
    rows = []
    for cells in news.section_cells(log_text, SECTION, stop_at_separator=True):
        if len(cells) >= 2 and CHANNEL_ID.fullmatch(cells[1]):
            rows.append((cells[0], cells[1]))
    return rows


def feed_videos(xml, since):
    """The feed's videos published on or after `since`, newest first, and whether more may exist:
    true when the feed is full and every entry in it is from the period. Raises ValueError on an answer that
    is not an Atom feed, and ElementTree.ParseError on one that is not XML."""
    root = ElementTree.fromstring(xml)
    if root.tag != "{%s}feed" % NS["atom"]:
        raise ValueError("the answer is not an Atom feed")
    entries = root.findall("atom:entry", NS)
    videos = []
    for entry in entries:
        published = entry.findtext("atom:published", "", NS)
        if published[:10] < since:
            continue
        link = entry.find("atom:link[@rel='alternate']", NS)
        videos.append({
            "id": entry.findtext("yt:videoId", "", NS),
            "title": entry.findtext("atom:title", "", NS),
            "description": entry.findtext("media:group/media:description", "", NS),
            "published": published,
            "link": link.get("href") if link is not None else "",
        })
    videos.sort(key=lambda video: video["published"], reverse=True)
    return videos, len(entries) >= FEED_SIZE and len(videos) == len(entries)


def channel_report(channel, channel_id, since):
    """One channel's part of the report: its videos, or the error that kept them out."""
    feed = FEED % channel_id
    report = {"channel": channel, "channel_id": channel_id, "feed": feed}
    body, error = news.fetch(feed)
    if body is None:
        body, error = news.fetch(feed)
    if body is None:
        report["error"] = error
        return report
    try:
        videos, more = feed_videos(body, since)
    except (ElementTree.ParseError, ValueError) as problem:
        report["error"] = "the feed could not be read: %s" % problem
        return report
    report.update(more_may_exist=more, videos=videos)
    return report


def list_videos(args):
    try:
        rows = channels(Path(args.log).read_text(encoding="utf-8"))
    except OSError as error:
        print("Cannot read the news log: %s" % error, file=sys.stderr)
        return 1
    if not rows:
        print("%s has no '%s' section with a channel in it." % (args.log, SECTION), file=sys.stderr)
        return 1
    reports = [channel_report(channel, channel_id, args.since) for channel, channel_id in rows]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"since": args.since, "channels": reports}, ensure_ascii=False, indent=2) + "\n")
    for report in reports:
        if "error" in report:
            print("failed   %s %s %s" % (report["channel"], report["feed"], report["error"]))
            continue
        line = "listed %3d %s %s" % (len(report["videos"]), report["channel"], report["feed"])
        if report["more_may_exist"]:
            line += " (the feed holds only the newest %d; more may exist)" % FEED_SIZE
        print(line)
    return 1 if any("error" in report for report in reports) else 0


def vtt_text(vtt):
    """The spoken text of a WebVTT file, one line each: no header, timings, tags or notes, and a line
    automatic captions repeat in the next cue kept once."""
    lines = []
    skipping = False
    for raw in vtt.splitlines():
        line = raw.strip()
        if not line:
            skipping = False
            continue
        if skipping or line.startswith(("WEBVTT", "Kind:", "Language:")) or "-->" in line:
            continue
        if line.startswith(("NOTE", "STYLE")):
            skipping = True
            continue
        text = html.unescape(re.sub(r"<[^>]*>", "", line)).strip()
        if text and (not lines or lines[-1] != text):
            lines.append(text)
    return "\n".join(lines)


def caption_line(link, out):
    """Fetch one video's captions: the line that reports them. Uploaded English captions are asked for
    first; without them, the automatic original track `en-orig`. YouTube answers 429 for the automatic
    `en` track, and one refused track fails the whole yt-dlp run."""
    with tempfile.TemporaryDirectory() as folder:
        heard = []
        for tracks in (["--write-subs", "--sub-langs", "en.*"], ["--write-auto-subs", "--sub-langs", "en-orig"]):
            command = [YT_DLP, "--skip-download", "--no-playlist", "--js-runtimes", "node", *tracks,
                       "--sub-format", "vtt", "--paths", folder, "-o", "%(id)s.%(ext)s", "--", link]
            try:
                done = subprocess.run(command, capture_output=True, text=True, timeout=TIME_LIMIT)
            except OSError as error:
                return "failed %s yt-dlp could not be run: %s" % (link, error)
            except subprocess.TimeoutExpired:
                return "failed %s yt-dlp ran past %d seconds" % (link, TIME_LIMIT)
            said = (done.stdout + "\n" + done.stderr).strip().splitlines()
            heard += said
            if done.returncode != 0:
                return "failed %s %s" % (link, said[-1] if said else "yt-dlp exit %d" % done.returncode)
            files = sorted(Path(folder).glob("*.vtt"))
            if files:
                break
        if not files:
            warning = next((line for line in heard if LEFT_OUT.search(line)), None)
            return "failed %s %s" % (link, warning) if warning else "none %s" % link
        chosen = next((f for f in files if f.name.endswith(".en.vtt")), files[0])
        path = Path(out) / (chosen.name.split(".")[0] + ".txt")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(vtt_text(chosen.read_text(encoding="utf-8", errors="replace")) + "\n", encoding="utf-8")
        return "captions %s %s" % (link, path)


def fetch_captions(args):
    failed = False
    for link in args.links:
        line = caption_line(link, args.out)
        failed = failed or line.startswith("failed")
        print(line)
    return 1 if failed else 0


def main(argv=None):
    news = Path.home() / ".aide" / "news-check"
    parser = argparse.ArgumentParser(prog="scripts/news/fetch-youtube.py", description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    videos = commands.add_parser("videos", help="list each channel's videos since a date")
    videos.add_argument("--since", required=True)
    videos.add_argument("--log", default=str(HERE.parents[1] / "docs" / "AI_NEWS_LOG.md"))
    videos.add_argument("--output", default=str(news / "youtube-videos.json"))
    captions = commands.add_parser("captions", help="fetch the English captions of at most %d videos" % MAX_CAPTIONS)
    captions.add_argument("--out", default=str(news / "youtube-captions"))
    captions.add_argument("links", nargs="+", metavar="LINK")
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    if args.command == "videos":
        return list_videos(args)
    if len(args.links) > MAX_CAPTIONS:
        captions.error("at most %d links in one call, got %d" % (MAX_CAPTIONS, len(args.links)))
    return fetch_captions(args)


if __name__ == "__main__":
    sys.exit(main())
