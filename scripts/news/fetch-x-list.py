#!/usr/bin/env python3
"""Collect public X list posts through FxTwitter without a browser."""

import argparse
import http.client
import json
import sys
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path


def fetch_page(params):
    url = "https://api.fxtwitter.com/2/search?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            return json.load(response)
    except http.client.IncompleteRead:
        response = subprocess.run(
            ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "20", url],
            capture_output=True, text=True, timeout=25,
        )
        if response.returncode != 0:
            raise OSError(f"FxTwitter transfer failed: {response.stderr[-300:]}")
        return json.loads(response.stdout)


def collect(list_id, since, until, fetch):
    posts = {}
    cursor = None
    cursors = set()
    for _ in range(100):
        params = {"q": f"list:{list_id}", "feed": "latest", "count": 100}
        if cursor:
            params["cursor"] = cursor
        page = fetch(params)
        if page.get("code") != 200 or not isinstance(page.get("results"), list):
            raise ValueError("FxTwitter returned an unsuccessful or malformed response")
        rows = page["results"]
        if any(not isinstance(p, dict) or not p.get("id") or
               not isinstance(p.get("created_timestamp"), (int, float)) for p in rows):
            raise ValueError("An X post is missing its id or timestamp")
        for post in rows:
            if since <= post["created_timestamp"] <= until:
                posts[post["id"]] = post
        times = [p["created_timestamp"] for p in rows]
        if not rows or (len(times) >= 3 and all(t < since for t in times[-3:])):
            return {"posts": sorted(posts.values(), key=lambda p: p["created_timestamp"], reverse=True), "complete": True}
        cursor = (page.get("cursor") or {}).get("bottom")
        if not cursor or cursor in cursors:
            raise ValueError("Pagination stopped before the requested time range was covered")
        cursors.add(cursor)
    raise ValueError("Page limit reached before the requested time range was covered")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--job-result", type=Path)
    args = parser.parse_args(argv)
    if args.job_result:
        args.job_result.parent.mkdir(parents=True, exist_ok=True)
        args.job_result.write_text(json.dumps({"ok": False, "error": "collection did not complete"}) + "\n")
    until = int(time.time())
    report = {"list_id": "1992629307080929379", "since": until - 86400, "until": until,
              "source": "https://api.fxtwitter.com/2/search"}
    deadline = time.monotonic() + 180
    def fetch(params):
        for attempt in range(3):
            if time.monotonic() >= deadline:
                raise ValueError("Collection time limit reached before the time range was covered")
            try:
                return fetch_page(params)
            except (OSError, http.client.HTTPException, subprocess.TimeoutExpired):
                if attempt == 2:
                    raise
    try:
        report.update(collect(report["list_id"], report["since"], until, fetch))
    except (OSError, http.client.HTTPException, subprocess.TimeoutExpired, ValueError, KeyError, TypeError) as error:
        report.update(complete=False, posts=[], error=str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if args.job_result:
        outcome = {"ok": report["complete"]}
        if not report["complete"]:
            outcome["error"] = report.get("error", "collection incomplete")
        args.job_result.write_text(json.dumps(outcome, ensure_ascii=False) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "posts"}))
    print(f"{len(report['posts'])} posts saved to {args.output}")
    return 0 if report["complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
