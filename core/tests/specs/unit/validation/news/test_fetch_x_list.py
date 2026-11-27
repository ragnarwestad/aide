"""List collection preserves full posts and proves its time coverage."""
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[6]
spec = importlib.util.spec_from_file_location("fetch_x_list", ROOT / "scripts/news/fetch-x-list.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def at(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def raw(id, seconds, text="post", **extra):
    return {"id": id, "author_id": "7", "created_at": at(seconds), "text": text, **extra}


def page(rows, next_token=None):
    return {"data": rows, "includes": {"users": [{"id": "7", "username": "someone", "name": "Some One"}]},
            "meta": {"result_count": len(rows), **({"next_token": next_token} if next_token else {})}}


def test_pages_are_deduplicated_and_filtered_without_shortening_text():
    text = "a" * 2800
    pages = iter([
        page([raw("future", 250), raw("a", 150, "short…", note_tweet={"text": text})], "next"),
        page([raw("a", 150, "short…", note_tweet={"text": text}), raw("b", 100), raw("old", 90)], "older"),
    ])
    calls = []
    def fetch(params):
        calls.append(params)
        return next(pages)
    result = reader.collect("123", 100, 200, fetch)
    assert [p["id"] for p in result["posts"]] == ["a", "b"]
    assert result["posts"][0]["text"] == text
    assert result["posts"][0]["url"] == "https://x.com/someone/status/a"
    assert result["posts"][0]["author"]["screen_name"] == "someone"
    assert calls[1]["pagination_token"] == "next"
    assert result["complete"] is True


def test_quoted_and_reposted_posts_keep_their_links():
    rows = [raw("q", 150, referenced_tweets=[{"type": "quoted", "id": "9"}]),
            raw("r", 140, referenced_tweets=[{"type": "retweeted", "id": "8"}]), raw("old", 90)]
    posts = reader.collect("123", 100, 200, lambda _: page(rows))["posts"]
    assert posts[0]["quote"]["url"] == "https://x.com/i/web/status/9"
    assert posts[1]["repost_of"]["id"] == "8"


@pytest.mark.parametrize("pages", [
    [{"errors": [{"title": "Unauthorized"}]}],
    [page([{"id": "a", "author_id": "7", "text": "missing time"}])],
    [page([raw("a", 150)])],
    [page([raw("a", 150)], "same")] * 3,
])
def test_incomplete_or_bad_responses_are_not_a_successful_digest(pages):
    replies = iter(pages)
    with pytest.raises(ValueError):
        reader.collect("123", 100, 200, lambda _: next(replies))


def test_page_cap_does_not_claim_a_complete_day():
    n = 0
    def fetch(_):
        nonlocal n
        n += 1
        assert n <= 101
        return page([raw(str(n), 150)], str(n))
    with pytest.raises(ValueError):
        reader.collect("123", 100, 200, fetch)


def test_command_writes_a_timestamped_report_and_reports_failure(tmp_path, monkeypatch):
    output = tmp_path / "posts.json"
    monkeypatch.setattr(reader, "fetch_page", lambda _: page([raw("old", 1)]))
    assert reader.main(["--output", str(output)]) == 0
    report = json.loads(output.read_text())
    assert report["complete"] is True
    assert report["until"] - report["since"] == 86400
    assert report["list_id"] == "1992629307080929379"
    def broken(_):
        raise OSError("upstream unavailable")
    monkeypatch.setattr(reader, "fetch_page", broken)
    assert reader.main(["--output", str(output)]) == 1
    report = json.loads(output.read_text())
    assert report["complete"] is False
    assert report["posts"] == []
    assert report["error"] == "upstream unavailable"


def test_a_missing_token_is_reported_not_sent(tmp_path, monkeypatch):
    monkeypatch.delenv("X_BEARER_TOKEN", raising=False)
    monkeypatch.setattr(reader, "TOKEN_FILE", tmp_path / "absent")
    monkeypatch.setattr(reader.urllib.request, "urlopen", lambda *a, **k: pytest.fail("no request without a token"))
    output = tmp_path / "posts.json"
    assert reader.main(["--output", str(output)]) == 1
    assert "No X API token" in json.loads(output.read_text())["error"]


def test_the_token_is_sent_as_a_bearer_header(monkeypatch):
    monkeypatch.setenv("X_BEARER_TOKEN", "secret")
    seen = []
    class Response:
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def read(self, *a):
            return b'{"data": []}'
    def urlopen(request, timeout):
        seen.append(request)
        return Response()
    monkeypatch.setattr(reader.urllib.request, "urlopen", urlopen)
    assert reader.fetch_page({"max_results": 100}) == {"data": []}
    assert seen[0].get_header("Authorization") == "Bearer secret"
    assert "/2/lists/1992629307080929379/tweets" in seen[0].full_url


@pytest.mark.parametrize("failures", [1, 3])
def test_incomplete_http_response_is_retried_or_recorded(tmp_path, monkeypatch, failures):
    import http.client
    calls = []
    def fetch(params):
        calls.append(params.copy())
        if len(calls) <= failures:
            raise http.client.IncompleteRead(b"partial", 100)
        return page([raw("old", 1)])
    monkeypatch.setattr(reader, "fetch_page", fetch)
    output = tmp_path / "posts.json"
    assert reader.main(["--output", str(output)]) == (0 if failures == 1 else 1)
    report = json.loads(output.read_text())
    assert len(calls) == (2 if failures == 1 else 3)
    assert all(p == calls[0] for p in calls)
    assert report["complete"] is (failures == 1)
    if failures == 3:
        assert "IncompleteRead" in report["error"]
        assert report["posts"] == []


def test_interrupted_urllib_response_uses_curl_with_the_token_on_stdin(monkeypatch):
    import http.client
    import subprocess
    monkeypatch.setenv("X_BEARER_TOKEN", "secret")
    def broken(*args, **kwargs):
        raise http.client.IncompleteRead(b"partial", 10)
    monkeypatch.setattr(reader.urllib.request, "urlopen", broken)
    calls = []
    def curl(argv, **kwargs):
        calls.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 0, json.dumps({"data": []}), "")
    monkeypatch.setattr(subprocess, "run", curl)
    assert reader.fetch_page({"max_results": 100}) == {"data": []}
    argv, kwargs = calls[0]
    assert argv[0] == "curl"
    assert not any("secret" in a for a in argv)
    assert kwargs["input"] == "Authorization: Bearer secret\n"


@pytest.mark.parametrize("complete", [True, False])
def test_collector_writes_a_machine_readable_job_result(tmp_path, monkeypatch, complete):
    monkeypatch.setattr(reader, "collect", lambda *args: {"posts": [], "complete": complete, **({} if complete else {"error": "transfer interrupted"})})
    result = tmp_path / "job-result.json"
    rc = reader.main(["--output", str(tmp_path / "posts.json"), "--job-result", str(result)])
    assert rc == (0 if complete else 1)
    data = json.loads(result.read_text())
    assert data["ok"] is complete
    if not complete:
        assert data["error"] == "transfer interrupted"
