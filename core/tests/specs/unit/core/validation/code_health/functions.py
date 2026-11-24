"""Function length and nesting depth, for Python and bash.

Each measurer returns {key: {"lines": n, "depth": d}}. A function's lines
run from its header to its last line; its depth is the deepest nesting of
control blocks inside it, a nested function counting on its own. A key is
unique per function: a name defined twice in one scope gets "#2", "#3"
after the first."""
import ast
import re


def _unique(key, seen):
    seen[key] = seen.get(key, 0) + 1
    return key if seen[key] == 1 else f"{key}#{seen[key]}"


# --- Python, through ast ------------------------------------------------------

_DEFS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)
_CONTROL = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith, ast.Match)
_CONTROL += (ast.TryStar,) if hasattr(ast, "TryStar") else ()


def _is_elif(node):
    """An `elif` is an If that is the whole orelse of another, at its column."""
    tail = node.orelse
    return len(tail) == 1 and isinstance(tail[0], ast.If) and tail[0].col_offset == node.col_offset


def _blocks(node):
    """The statement lists one level inside a control block."""
    lists = [getattr(node, "body", []), getattr(node, "finalbody", [])]
    if not (isinstance(node, ast.If) and _is_elif(node)):
        lists.append(getattr(node, "orelse", []))
    lists += [handler.body for handler in getattr(node, "handlers", [])]
    lists += [case.body for case in getattr(node, "cases", [])]
    return lists


def _depth(statements, level=0):
    deepest = level
    for node in statements:
        if isinstance(node, _DEFS) or not isinstance(node, _CONTROL):
            continue
        for block in _blocks(node):
            deepest = max(deepest, _depth(block, level + 1))
        if isinstance(node, ast.If) and _is_elif(node):
            deepest = max(deepest, _depth(node.orelse, level))
    return deepest


def _child_statements(node):
    """The statements directly inside a statement: a def is always one."""
    for field in ("body", "orelse", "finalbody"):
        yield from getattr(node, field, [])
    for part in [*getattr(node, "handlers", []), *getattr(node, "cases", [])]:
        yield from part.body


def python_functions(source):
    found, seen = {}, {}

    def visit(node, prefix):
        for child in _child_statements(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                key = _unique(f"{prefix}{child.name}", seen)
                if not isinstance(child, ast.ClassDef):
                    lines = child.end_lineno - child.lineno + 1
                    found[key] = {"lines": lines, "depth": _depth(child.body)}
                visit(child, f"{key}.")
            else:
                visit(child, prefix)

    visit(ast.parse(source), "")
    return found


# --- bash, through a line scanner --------------------------------------------

# A header with its `{` on the same line, or alone on the next.
_HEADER = re.compile(r"^(\s*)(?:function\s+([\w:.-]+)\s*(?:\(\))?|([\w:.-]+)\s*\(\))\s*(\{)?\s*(?:#.*)?$")
_HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_]\w*)\1")
_TOKEN = re.compile(r";;|&&|\|\||[;|&(){}]|[^\s;|&(){}]+")
_OPENERS = {"if", "for", "while", "until", "case", "select"}
_CLOSERS = {"fi", "done", "esac"}
_AFTER_BRACE = {"", " ", "\t", ";", "|", "&", ">", "<"}
# After these a new command starts, so the next word may be a keyword.
_COMMAND_START = {";", ";;", "&&", "||", "|", "&", "(", "{", "then", "do", "else", "elif"}


def _blank_quotes(line, quote):
    """The line with quoted text and a comment blanked, and the quote still
    open at its end: an awk or jq program in quotes runs over many lines,
    and its words open nothing."""
    out, index = [], 0
    while index < len(line):
        char = line[index]
        if quote is None and char == "#" and (index == 0 or line[index - 1].isspace()):
            break
        if char == "\\" and quote != "'":
            out.append("  " if quote else line[index:index + 2])
            index += 2
            continue
        if quote is None and char in "'\"":
            quote = char
        elif char == quote:
            quote = None
        elif quote:
            char = " "
        out.append(char)
        index += 1
    return "".join(out), quote


def _code_lines(lines):
    """Each line with heredoc bodies and quoted text blanked."""
    out, end, quote = [], None, None
    for line in lines:
        if end is not None:
            out.append("")
            end = None if line.strip() == end else end
            continue
        match = _HEREDOC.search(line.replace("<<<", "   ")) if quote is None else None
        code, quote = _blank_quotes(line, quote)
        out.append(code)
        end = match.group(2) if match else None
    return out


def _level_change(line, level, deepest):
    """Walk one line's words, returning the level after it and the deepest seen."""
    starts = True
    for token in _TOKEN.findall(line):
        if starts and token in _OPENERS:
            level += 1
            deepest = max(deepest, level)
        elif starts and token in _CLOSERS:
            level -= 1
        starts = token in _COMMAND_START
    return level, deepest


def _bash_end(lines, start, indent):
    """The line of the `}` at the header's own indentation that closes it."""
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if line.startswith(indent + "}") and line[len(indent) + 1:len(indent) + 2] in _AFTER_BRACE:
            return index
    return len(lines) - 1


def _bash_header(lines, index):
    """(name, line of its `{`, indentation) when a function starts at `index`."""
    header = _HEADER.match(lines[index])
    if not header:
        return None
    brace = index
    if not header.group(4):
        brace = index + 1
        if brace >= len(lines) or lines[brace].strip() != "{":
            return None
    indent = re.match(r"\s*", lines[brace]).group(0)
    return header.group(2) or header.group(3), brace, indent


def bash_functions(source):
    lines = _code_lines(source.splitlines())
    found, seen = {}, {}
    for index in range(len(lines)):
        header = _bash_header(lines, index)
        if not header:
            continue
        name, brace, indent = header
        end = _bash_end(lines, brace, indent)
        level = deepest = 0
        for body in lines[brace + 1:end]:
            level, deepest = _level_change(body, level, deepest)
        found[_unique(name, seen)] = {"lines": end - index + 1, "depth": deepest}
    return found
