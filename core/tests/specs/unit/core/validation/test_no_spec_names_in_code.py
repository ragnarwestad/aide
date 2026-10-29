"""A comment, a docstring and a test title say what the code does. They never
name the spec, the requirement or the acceptance criterion that brought it:
`git log` and `git blame` keep that link.

This file reads every comment and title in the four code folders and fails
with each one that holds such a name. A test or `it` title may still carry an
acceptance criterion id, since the coverage record reads it there; a spec
number, a requirement id or a criterion number is never allowed.
"""
import ast
import bisect
import io
import json
import re
import subprocess
import tokenize
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[6]
FOLDERS = ("dashboard/src", "dashboard/test", "core/scripts", "core/tests")
TEST_FOLDERS = ("dashboard/test", "core/tests")

SPEC_NUMBER = re.compile(r"\b[Ss]pecs?\s+#?\d+\b(?!-)")
REQUIREMENT = re.compile(r"\bREQ-\d+|\b[Rr]equirements?\s+\d+\b")
CRITERION_NUMBER = re.compile(r"\b[Cc]riteri(?:on|a)\s+\d+\b")
CRITERION_ID = re.compile(r"\bAC-?\d+")
ANY_ID = (SPEC_NUMBER, REQUIREMENT, CRITERION_NUMBER, CRITERION_ID)
NO_CRITERION_ID = (SPEC_NUMBER, REQUIREMENT, CRITERION_NUMBER)
PYTHON_NAME_ID = re.compile(r"(?:^|_)(?:spec|req|criterion|criteria)_\d+(?:_|$)")

TS_TOKEN = re.compile(r"//|/\*|[\"'`/{}]")
CSS_TOKEN = re.compile(r"/\*|[\"']")
TITLE_WORD = re.compile(r"\b(describe|test|it)\b")
KEYWORDS_BEFORE_REGEX = {
    "return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await",
}
MODIFIERS = ("skip", "only", "todo", "if", "each", "concurrent", "serial", "failing")
HEREDOC = re.compile(r"<<(?!<)-?\s*(['\"]?)(\w+)\1")


class Span:
    """A stretch of source text: a comment, or a title."""

    def __init__(self, start, end, kind):
        self.start, self.end, self.kind = start, end, kind

    def __repr__(self):
        return f"Span({self.start}, {self.end}, {self.kind!r})"


def _end_of_quote(src, i, quote):
    j = i + 1
    while j < len(src):
        ch = src[j]
        if ch == "\\":
            j += 2
            continue
        if ch == quote:
            return j + 1
        if ch == "\n":
            return j
        j += 1
    return len(src)


def _starts_a_regex(src, i):
    j = i - 1
    while j >= 0 and src[j] in " \t\r\n":
        j -= 1
    if j < 0:
        return True
    ch = src[j]
    if ch.isalnum() or ch in "_$":
        k = j
        while k >= 0 and (src[k].isalnum() or src[k] in "_$"):
            k -= 1
        return src[k + 1:j + 1] in KEYWORDS_BEFORE_REGEX
    return ch not in ")]}"


def scan_script(src, css=False):
    """Return the comment spans and the string spans of TypeScript or CSS."""
    comments, strings = [], []
    pattern = CSS_TOKEN if css else TS_TOKEN
    n = len(src)
    i = 0
    depth = 0
    templates = []  # (start of the template, brace depth outside its open expression)

    def read_template(j):
        # Returns the index after the closing backtick, or -1 when an expression opens.
        while j < n:
            ch = src[j]
            if ch == "\\":
                j += 2
            elif ch == "`":
                return j + 1
            elif ch == "$" and src[j + 1:j + 2] == "{":
                return -(j + 2)
            else:
                j += 1
        return n

    while True:
        m = pattern.search(src, i)
        if not m:
            break
        tok = m.group()
        i = m.start()
        if tok == "//":
            e = src.find("\n", i)
            e = n if e < 0 else e
            comments.append((i, e))
            i = e
        elif tok == "/*":
            e = src.find("*/", i + 2)
            e = n if e < 0 else e + 2
            comments.append((i, e))
            i = e
        elif tok in "\"'":
            e = _end_of_quote(src, i, tok)
            strings.append((i, e))
            i = e
        elif tok == "`":
            templates.append((i, depth))
            r = read_template(i + 1)
            if r < 0:
                templates[-1] = (i, depth)
                depth = 0
                i = -r
            else:
                strings.append((i, r))
                templates.pop()
                i = r
        elif tok == "{":
            depth += 1
            i += 1
        elif tok == "}":
            if depth == 0 and templates:
                start, outer = templates[-1]
                depth = outer
                r = read_template(i + 1)
                if r < 0:
                    templates[-1] = (start, depth)
                    depth = 0
                    i = -r
                else:
                    templates.pop()
                    strings.append((start, r))
                    i = r
            else:
                depth = max(0, depth - 1)
                i += 1
        else:  # a slash: a regular expression literal or a division
            if _starts_a_regex(src, i):
                j = i + 1
                in_class = False
                closed = False
                while j < n:
                    ch = src[j]
                    if ch == "\\":
                        j += 2
                        continue
                    if ch == "\n":
                        break
                    if ch == "[":
                        in_class = True
                    elif ch == "]":
                        in_class = False
                    elif ch == "/" and not in_class:
                        j += 1
                        closed = True
                        break
                    j += 1
                if closed:
                    strings.append((i, j))
                    i = j
                    continue
            i += 1
    return comments, strings


def _closing(src, i, mask, open_ch, close_ch):
    depth = 0
    for j in range(i, len(src)):
        if mask[j]:
            continue
        if src[j] == open_ch:
            depth += 1
        elif src[j] == close_ch:
            depth -= 1
            if depth == 0:
                return j + 1
    return len(src)


def script_spans(src, css=False):
    comments, strings = scan_script(src, css)
    spans = [Span(a, b, "comment") for a, b in comments]
    if css:
        return spans
    mask = bytearray(len(src))
    for a, b in strings:
        mask[a:b] = b"\x01" * (b - a)
    for a, b in comments:
        mask[a:b] = b"\x01" * (b - a)
    string_end = dict(strings)
    for m in TITLE_WORD.finditer(src):
        if mask[m.start()]:
            continue
        j = m.end()
        after_dot = src[m.start() - 1:m.start()] == "."
        if after_dot:
            continue
        while src[j:j + 1] == ".":
            word = re.match(r"\.(\w+)", src[j:])
            if not word or word.group(1) not in MODIFIERS:
                break
            j += word.end()
            if word.group(1) in ("each", "if") and src[j:j + 1] == "(":
                j = _closing(src, j, mask, "(", ")")
        if src[j:j + 1] != "(":
            continue
        j += 1
        while src[j:j + 1] in (" ", "\t", "\n", "\r"):
            j += 1
        if src[j:j + 1] in ("'", '"', "`") and j in string_end:
            kind = "describe" if m.group(1) == "describe" else "test"
            spans.append(Span(j + 1, string_end[j] - 1, kind))
    return spans


def line_offsets(src):
    starts = [0]
    for m in re.finditer("\n", src):
        starts.append(m.end())
    return starts


def python_spans(src):
    spans = []
    starts = line_offsets(src)
    lines = src.split("\n")

    def offset(lineno, col):
        text = lines[lineno - 1].encode()[:col].decode(errors="ignore")
        return starts[lineno - 1] + len(text)

    try:
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            if tok.type == tokenize.COMMENT:
                a = starts[tok.start[0] - 1] + tok.start[1]
                spans.append(Span(a, a + len(tok.string), "comment"))
        tree = ast.parse(src)
    except (tokenize.TokenError, SyntaxError, IndentationError):
        return spans
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            v = node.value
            spans.append(Span(offset(v.lineno, v.col_offset), offset(v.end_lineno, v.end_col_offset), "comment"))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_"):
            line_start = starts[node.lineno - 1]
            m = re.compile(r"def\s+(" + re.escape(node.name) + r")\b").search(src, line_start)
            if m:
                spans.append(Span(m.start(1), m.end(1), "testname"))
    return spans


def shell_spans(src):
    spans = []
    quote = None
    heredoc = None
    pos = 0
    for number, line in enumerate(src.split("\n")):
        start = pos
        pos += len(line) + 1
        if heredoc:
            if line.strip() == heredoc:
                heredoc = None
            continue
        stripped = line.lstrip()
        if stripped.startswith("#") and not (number == 0 and stripped.startswith("#!")):
            spans.append(Span(start + len(line) - len(stripped), start + len(line), "comment"))
            continue
        j = 0
        while j < len(line):
            ch = line[j]
            if quote:
                if ch == "\\" and quote == '"':
                    j += 2
                    continue
                if ch == quote:
                    quote = None
            else:
                if ch == "\\":
                    j += 2
                    continue
                if ch in "\"'":
                    quote = ch
                elif ch == "#" and (j == 0 or line[j - 1] in " \t;"):
                    spans.append(Span(start + j, start + len(line), "comment"))
                    break
            j += 1
        else:
            if not quote:
                m = HEREDOC.search(line)
                if m:
                    heredoc = m.group(2)
    return spans


def json_spans(src):
    spans = []
    for m in re.finditer(r'"_comment"\s*:\s*', src):
        j = m.end()
        if src[j:j + 1] == '"':
            e = _end_of_quote(src, j, '"')
            spans.append(Span(j + 1, e - 1, "comment"))
        elif src[j:j + 1] == "[":
            end = src.find("]", j)
            for s in re.finditer(r'"((?:[^"\\]|\\.)*)"', src[j:end]):
                spans.append(Span(j + s.start(1), j + s.end(1), "comment"))
    return spans


def kind_of_file(path, src):
    suffix = path.rsplit(".", 1)[-1] if "." in path.rsplit("/", 1)[-1] else ""
    if suffix in ("ts", "css", "py", "sh", "json"):
        return suffix
    if suffix == "":
        first = src.split("\n", 1)[0]
        if first.startswith("#!"):
            if "python" in first:
                return "py"
            if "bash" in first or first.rstrip().endswith("/sh"):
                return "sh"
    return None


def spans_of(path, src):
    kind = kind_of_file(path, src)
    if kind == "ts":
        return script_spans(src)
    if kind == "css":
        return script_spans(src, css=True)
    if kind == "py":
        return python_spans(src)
    if kind == "sh":
        return shell_spans(src)
    if kind == "json":
        return json_spans(src)
    return []


def _hide_backticked(text):
    return re.sub(r"`[^`]*`", lambda m: " " * len(m.group()), text)


LINE_MARKER = re.compile(r"^[ \t]*(?://+|#+|\*(?!/)|/\*+|\"\"\"|\'\'\')?[ \t]*")


def wrapped_hits(src, spans, in_tests):
    """Names split by a line break: the word at the end of one comment line and the number on the next."""
    starts = line_offsets(src)
    pieces = {}
    for span in spans:
        if span.kind != "comment":
            continue
        offset = span.start
        for line in src[span.start:span.end].split("\n"):
            number = bisect.bisect_right(starts, offset)
            head = LINE_MARKER.match(line).end()
            pieces.setdefault(number, []).append((offset + head, line[head:].rstrip()))
            offset += len(line) + 1
    found = []
    for number, first in pieces.items():
        second = pieces.get(number + 1)
        if not second:
            continue
        tail = first[-1][1][-24:]
        head = second[0][1][:16]
        if in_tests:
            tail, head = _hide_backticked(tail), _hide_backticked(head)
        joined = tail + " " + head
        for pattern in ANY_ID:
            for m in pattern.finditer(joined):
                if m.start() < len(tail) < m.end():
                    found.append((first[-1][0] + len(first[-1][1]) - len(tail) + m.start(), m.group()))
    return found


def hits_in(path, src):
    """Return (offset, matched text) for every name of a spec, a requirement or a criterion."""
    found = []
    in_tests = path.startswith(TEST_FOLDERS)
    spans = spans_of(path, src)
    found.extend(wrapped_hits(src, spans, in_tests))
    for span in spans:
        text = src[span.start:span.end]
        if span.kind == "comment":
            if in_tests:
                text = _hide_backticked(text)
            patterns = ANY_ID
        elif span.kind == "describe":
            patterns = ANY_ID
        elif span.kind == "test":
            patterns = NO_CRITERION_ID
        else:
            m = PYTHON_NAME_ID.search(text)
            if m:
                found.append((span.start + m.start(), text))
            continue
        for pattern in patterns:
            for m in pattern.finditer(text):
                found.append((span.start + m.start(), m.group()))
    return sorted(set(found))


def tracked_files():
    out = subprocess.run(
        ["git", "-c", "core.quotepath=false", "-C", str(REPO), "ls-files", "-z", "--", *FOLDERS],
        capture_output=True, text=True, check=True,
    ).stdout
    return [p for p in out.split("\0") if p]


def read(path):
    try:
        return (REPO / path).read_text(encoding="utf-8")
    except (UnicodeDecodeError, FileNotFoundError):
        return None


def all_hits():
    report = []
    for path in tracked_files():
        src = read(path)
        if src is None:
            continue
        found = hits_in(path, src)
        if not found:
            continue
        starts = line_offsets(src)
        lines = src.split("\n")
        for offset, matched in found:
            number = bisect.bisect_right(starts, offset)
            report.append(f"{path}:{number}: {lines[number - 1].strip()[:140]}")
    return report


# --- The readers, on short samples -------------------------------------------------

COMMENT_SAMPLES = [
    ("a.ts", "const a = 1; // (spec 352) the reason\n"),
    ("a.ts", "/* Spec 89: the board\n * shows it */\nconst a = 1;\n"),
    ("a.ts", "const a = `x ${f(/* REQ-4 */ 1)} y`;\n"),
    ("a.css", "a { color: red; } /* AC-4 colour */\n"),
    ("a.py", "x = 1  # criterion 3 holds\n"),
    ("a.py", "def f():\n    '''The old spec 12 rule.'''\n    return 1\n"),
    ("a.sh", "echo hi # REQ-2 says so\n"),
    ("a.sh", "# --- AC-1: legal from here\n"),
    ("a.json", '{"_comment": "spec 410 added this"}\n'),
    ("a.json", '{"_comment": ["fine", "requirement 5 asks"]}\n'),
    ("tool", "#!/usr/bin/env bash\n# spec 77 wants this\n"),
]

NOT_A_HIT_SAMPLES = [
    ("a.ts", 'const row = "| AC-1: x |";\n'),
    ("a.ts", "const fixture = \"- **REQ-1:** a requirement\";\n"),
    ("a.ts", 'const url = "https://example.com/spec 4";\nconst b = 2;\n'),
    ("a.ts", 'const r = s.replace(/`/g, ""); // fine\nconst t = "// spec 9";\n'),
    ("a.ts", "const t = `// spec 9 ${1}`;\n"),
    ("dashboard/test/a.ts", "// the row `AC-1` is a fixture's own\nconst a = 1;\n"),
    ("a.ts", "// a folder such as spec 484-x is data\nconst a = 1;\n"),
    ("a.ts", 'test("a row keeps its place (AC-1)", () => {});\n'),
    ("a.ts", "// a format such as AC-n or REQ-n is generic\n"),
    ("a.py", 'x = "spec 12"\n'),
    ("a.py", "def test_a_row_keeps_its_place_ac_1():\n    pass\n"),
    ("a.sh", 'echo "spec 12 # not a comment"\n'),
    ("a.sh", "cat <<EOF\n# spec 12 in a heredoc\nEOF\n"),
    ("a.json", '{"title": "spec 12"}\n'),
    ("a.md", "spec 12\n"),
]

TITLE_SAMPLES = [
    ("a.ts", 'describe("REQ-7: a closed row", () => {});\n'),
    ("a.ts", 'describe("a closed row (AC-7)", () => {});\n'),
    ("a.ts", 'test("spec 406 keeps a row", () => {});\n'),
    ("a.ts", 'it.skip(\n  "criterion 3 holds",\n  () => {});\n'),
    ("a.ts", 'test.each([[1, "a (b)"]])("spec 4 takes %s", (x) => {});\n'),
    ("a.py", "def test_spec_352_keeps_a_row():\n    pass\n"),
]


@pytest.mark.parametrize("path,src", COMMENT_SAMPLES)
def test_a_name_in_each_kind_of_comment_is_found(path, src):
    assert hits_in(path, src) != []


@pytest.mark.parametrize("path,src", NOT_A_HIT_SAMPLES)
def test_data_and_generic_ids_are_left_alone(path, src):
    assert hits_in(path, src) == []


@pytest.mark.parametrize("path,src", TITLE_SAMPLES)
def test_a_name_in_a_title_is_found(path, src):
    assert hits_in(path, src) != []


def test_a_criterion_id_in_a_test_title_is_let_through_but_not_in_a_describe_title():
    assert hits_in("a.ts", 'test("a row (AC-1)", () => {});\n') == []
    assert hits_in("a.ts", 'describe("a row (AC-1)", () => {});\n') != []


def test_the_listing_finds_files_in_each_folder():
    files = tracked_files()
    for folder in FOLDERS:
        assert [p for p in files if p.startswith(folder + "/")], f"no tracked file under {folder}"


def test_a_name_split_over_two_comment_lines_is_found():
    assert hits_in("a.ts", "// the rule from spec\n// 12 holds\n") != []
    assert hits_in("a.py", "# see the rule in\n# the spec 9\n") != []
    assert hits_in("a.ts", "// the rule from the spec\n// holds\n") == []


def test_the_rewrite_readers_find_a_leading_label_in_a_block_comment():
    src = "/** REQ-4 (spec 424): what it does */\n"
    assert [src[s.start:s.end] for s in script_spans(src)] == [src.rstrip("\n")]


def test_no_comment_or_title_in_the_code_folders_names_a_spec_a_requirement_or_a_criterion():
    report = all_hits()
    assert report == [], (
        f"{len(report)} comments or titles name a spec, a requirement or a criterion. "
        "Write what the code does, keep a reason in plain words, and leave the link to git log "
        "and git blame:\n" + "\n".join(report[:200])
    )
