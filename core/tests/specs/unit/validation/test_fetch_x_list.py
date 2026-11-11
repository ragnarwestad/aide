"""List collection preserves full posts and proves its time coverage."""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[5]
spec = importlib.util.spec_from_file_location("fetch_x_list", ROOT / "scripts/fetch-x-list.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def test_pages_are_deduplicated_and_filtered_without_shortening_text():
    text = "a" * 2800
    pages = iter([
        {"code": 200, "results": [{"id": "future", "created_timestamp": 250, "text": "later"}, {"id": "a", "created_timestamp": 150, "text": text}], "cursor": {"bottom": "next"}},
        {"code": 200, "results": [{"id": "a", "created_timestamp": 150, "text": text},
            {"id": "b", "created_timestamp": 100, "text": "boundary"},
            *[{"id": str(n), "created_timestamp": 90, "text": "old"} for n in range(3)]], "cursor": {"bottom": "older"}},
    ])
    calls = []
    def fetch(params):
        calls.append(params)
        return next(pages)
    result = reader.collect("123", 100, 200, fetch)
    assert [p["id"] for p in result["posts"]] == ["a", "b"]
    assert result["posts"][0]["text"] == text
    assert calls[1]["cursor"] == "next"
    assert result["complete"] is True


@pytest.mark.parametrize("pages", [
    [{"code": 500, "results": [], "cursor": {}}],
    [{"code": 200, "results": [{"id": "a", "text": "missing time"}], "cursor": {}}],
    [{"code": 200, "results": [{"id": "a", "created_timestamp": 150}], "cursor": {}}],
    [{"code": 200, "results": [{"id": "a", "created_timestamp": 150}], "cursor": {"bottom": "same"}}] * 3,
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
        return {"code": 200, "results": [{"id": str(n), "created_timestamp": 150}], "cursor": {"bottom": str(n)}}
    with pytest.raises(ValueError):
        reader.collect("123", 100, 200, fetch)


def test_command_writes_a_timestamped_report_and_reports_failure(tmp_path, monkeypatch):
    import json
    output = tmp_path / "posts.json"
    monkeypatch.setattr(reader, "fetch_page", lambda _: {"code": 200, "results": [], "cursor": {}})
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


@pytest.mark.parametrize("failures", [1, 3])
def test_incomplete_http_response_is_retried_or_recorded(tmp_path, monkeypatch, failures):
    import http.client
    import json
    calls = []
    def fetch(params):
        calls.append(params.copy())
        if len(calls) <= failures:
            raise http.client.IncompleteRead(b"partial", 100)
        return {"code": 200, "results": [], "cursor": {}}
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
