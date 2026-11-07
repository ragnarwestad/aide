"""The result file's structured fields against core/tests/fixtures/result-fields.json,
the cases the dashboard's parsers are tested on.

Every key the runner writes must be one a case of that field knows, with
the same JSON type, all the way down; a case with a `kind` is matched only
against cases of that kind. A key may be left out, since the runner leaves
out what it does not know.
"""

import json
import pathlib

_FIXTURE = pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "result-fields.json"
FIELDS = json.loads(_FIXTURE.read_text())["fields"]


def _type(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def _unknown(value, known, path):
    """What in `value` none of the `known` values has, as paths."""
    types = {_type(k) for k in known}
    if _type(value) not in types:
        return [f"{path or '.'}: {_type(value)}, known as {sorted(types)}"]
    if isinstance(value, dict):
        found = []
        for key, inner in value.items():
            same = [k[key] for k in known if isinstance(k, dict) and key in k]
            found += _unknown(inner, same, f"{path}.{key}") if same else [f"{path}.{key}: not in the fixture"]
        return found
    if isinstance(value, list):
        items = [i for k in known if isinstance(k, list) for i in k]
        return [p for v in value for p in (_unknown(v, items, f"{path}[]") if items else [])]
    return []


def assert_written_as_in_fixture(field, value):
    cases = [c["written"] for c in FIELDS[field]]
    if isinstance(value, dict) and "kind" in value:
        cases = [c for c in cases if c.get("kind") == value["kind"]]
        assert cases, f"{field}: kind {value['kind']!r} is not in result-fields.json"
    unknown = _unknown(value, cases, "")
    assert not unknown, f"{field} written in a shape result-fields.json does not know: {unknown}"
