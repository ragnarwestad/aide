#!/usr/bin/env python3
"""Collect public X list posts through the X API without a browser."""

import argparse
import http.client
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

LIST_ID = "1992629307080929379"
API = "https://api.x.com/2/lists/{}/tweets"
TOKEN_FILE = Path.home() / ".aide" / "x-bearer-token"
FIELDS = {
    "max_results": 100,
    "tweet.fields": "created_at,author_id,lang,note_tweet,referenced_tweets,public_metrics,article,entities",
    "expansions": "author_id",
    "user.fields": "username,name",
}


def token():
    value = os.environ.get("X_BEARER_TOKEN") or (TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else "")
    if not value:
        raise ValueError(f"No X API token: set X_BEARER_TOKEN or write it to {TOKEN_FILE}")
    return value


def fetch_page(params):
    url = API.format(LIST_ID) + "?" + urllib.parse.urlencode(params)
    bearer = f"Bearer {token()}"
    request = urllib.request.Request(url, headers={"Authorization": bearer})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")[:300]
        raise OSError(f"X API answered HTTP {error.code}: {body}") from None
    except http.client.IncompleteRead:
        # The header goes on stdin, so the token never shows in a process list.
        response = subprocess.run(
            ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "20", "-H", "@-", url],
            input=f"Authorization: {bearer}\n", capture_output=True, text=True, timeout=25,
        )
        if response.returncode != 0:
            raise OSError(f"X API transfer failed: {response.stderr[-300:]}")
        return json.loads(response.stdout)


def timestamp(created_at):
    return int(datetime.fromisoformat(created_at.replace("Z", "+00:00")).timestamp())


def post(raw, users):
    author = users.get(raw["author_id"], {})
    name = author.get("username")
    refs = {r["type"]: r["id"] for r in raw.get("referenced_tweets") or []}
    out = {
        "id": raw["id"],
        "url": f"https://x.com/{name or 'i/web'}/status/{raw['id']}",
        "text": (raw.get("note_tweet") or {}).get("text") or raw["text"],
        "created_at": raw["created_at"],
        "created_timestamp": timestamp(raw["created_at"]),
        "author": {"id": raw["author_id"], "screen_name": name, "name": author.get("name")},
        "lang": raw.get("lang"),
        "metrics": raw.get("public_metrics"),
        "urls": [u.get("expanded_url") for u in (raw.get("entities") or {}).get("urls", []) if u.get("expanded_url")],
    }
    for kind, key in (("quoted", "quote"), ("retweeted", "repost_of"), ("replied_to", "replying_to")):
        if kind in refs:
            out[key] = {"id": refs[kind], "url": f"https://x.com/i/web/status/{refs[kind]}"}
    if raw.get("article"):
        out["article"] = raw["article"]
    return out


def collect(list_id, since, until, fetch):
    posts = {}
    token_seen = set()
    next_token = None
    for _ in range(100):
        params = dict(FIELDS)
        if next_token:
            params["pagination_token"] = next_token
        page = fetch(params)
        if page.get("errors") and "data" not in page:
            raise ValueError(f"X API error: {json.dumps(page['errors'])[:300]}")
        rows = page.get("data", [])
        if not isinstance(rows, list) or any(
                not isinstance(p, dict) or not p.get("id") or not p.get("created_at") for p in rows):
            raise ValueError("An X post is missing its id or timestamp")
        users = {u["id"]: u for u in (page.get("includes") or {}).get("users", []) if u.get("id")}
        times = []
        for raw in rows:
            item = post(raw, users)
            times.append(item["created_timestamp"])
            if since <= item["created_timestamp"] <= until:
                posts[item["id"]] = item
        if times and min(times) < since:
            return {"posts": sorted(posts.values(), key=lambda p: p["created_timestamp"], reverse=True), "complete": True}
        next_token = (page.get("meta") or {}).get("next_token")
        if not next_token or next_token in token_seen:
            raise ValueError("The list's history ended before the requested time range was covered")
        token_seen.add(next_token)
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
    report = {"list_id": LIST_ID, "since": until - 86400, "until": until, "source": API.format(LIST_ID)}
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
