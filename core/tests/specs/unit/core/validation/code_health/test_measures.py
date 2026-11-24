"""The measurers and the held comparison, on small snippets: function
length and nesting for Python and bash, repeated blocks, and the rule that
held code fails only when it gets worse."""
from .duplicates import duplicates
from .functions import bash_functions, python_functions
from .held import MAX_DEPTH, MAX_LINES, duplicate_failures, function_failures


def python_function(name, body_lines, indent=""):
    lines = [f"{indent}def {name}(self):"]
    lines += [f"{indent}    x{i} = {i}" for i in range(body_lines - 1)]
    return "\n".join(lines) + "\n"


DEEP_PYTHON = """
def deep(items):
    if items:
        for item in items:
            while item:
                try:
                    with open(item) as f:
                        return f
                except OSError:
                    pass
    else:
        return []
"""

ELIF_PYTHON = """
def chain(a):
    if a == 1:
        for x in a:
            while x:
                with x:
                    pass
    elif a == 2:
        pass
    elif a == 3:
        pass
    elif a == 4:
        for y in a:
            if y:
                pass
    else:
        pass
"""

DEEP_BASH = """
deep() {
  if [ -n "$1" ]; then
    case "$1" in
      a)
        while read -r line; do
          for word in $line; do
            if [ "$word" = x ]; then echo "$word"; fi
          done
        done
        ;;
    esac
  fi
}
"""

HEREDOC_BASH = """
function shallow {
  if true; then
    for x in a b; do
      while false; do
        case "$x" in
          *)
            cat <<EOF
if this were code
while it is not
EOF
            ;;
        esac
      done
    done
  fi
}
"""


def test_a_python_function_over_sixty_lines_fails_with_no_held_entry_AC_1():
    measured = python_functions(python_function("long", MAX_LINES + 1) + python_function("fits", MAX_LINES))
    assert measured["long"]["lines"] == 61
    assert measured["fits"]["lines"] == 60
    failures = function_failures({f"a.py::{k}": v for k, v in measured.items()}, {})
    assert len(failures) == 1
    assert "a.py::long" in failures[0] and "61" in failures[0] and "60" in failures[0]


def test_python_nesting_counts_control_blocks_and_not_an_elif_chain_AC_1():
    assert python_functions(DEEP_PYTHON)["deep"]["depth"] == 5
    assert python_functions(ELIF_PYTHON)["chain"]["depth"] == MAX_DEPTH
    failures = function_failures({"a.py::deep": python_functions(DEEP_PYTHON)["deep"]}, {})
    assert len(failures) == 1 and "5" in failures[0] and "4" in failures[0]
    assert function_failures({"a.py::chain": python_functions(ELIF_PYTHON)["chain"]}, {}) == []


def test_python_keys_are_qualified_and_unique_per_function_AC_1():
    source = "class C:\n" + python_function("value", 3, "    ") + python_function("value", 4, "    ")
    source += "def outer():\n" + python_function("inner", 2, "    ")
    assert set(python_functions(source)) == {"C.value", "C.value#2", "outer", "outer.inner"}


def test_bash_nesting_counts_control_blocks_and_skips_heredocs_AC_1():
    assert bash_functions(DEEP_BASH)["deep"]["depth"] == 5
    assert bash_functions(DEEP_BASH)["deep"]["lines"] == 13
    assert bash_functions(HEREDOC_BASH)["shallow"]["depth"] == 4


def test_a_bash_function_ends_at_the_brace_at_its_own_indentation_AC_1():
    body = "\n".join(f"  echo {i}" for i in range(MAX_LINES - 2))
    source = f"first() {{\n{body}\n  {{ echo grouped; }}\n}}\nsecond() {{\n  echo two\n}}\nfirst\n"
    measured = bash_functions(source)
    assert measured["first"]["lines"] == MAX_LINES + 1
    assert measured["second"] == {"lines": 3, "depth": 0}


def shared_lines(count):
    return [f"value_{i} = compute({i}, 'shared')" for i in range(count)]


def test_eight_shared_lines_are_reported_in_both_files_and_seven_are_not_AC_1():
    files = {
        "a.py": "\n".join(["import a", *shared_lines(8), "a_only()"]),
        "b.py": "\n".join(["# a comment", "", "import b", *shared_lines(8)]),
        "c.py": "\n".join(shared_lines(7)),
        "d.py": "\n".join(["d_first()", *shared_lines(7), "d_last()"]),
    }
    found = duplicates(files)
    assert set(found) == {"a.py", "b.py"}
    assert found["a.py"] == [(2, "b.py", 4)]
    assert duplicates({"c.py": files["c.py"], "d.py": files["d.py"]}) == {}


def test_blank_comment_and_closing_lines_do_not_count_toward_a_block_AC_1():
    padded = []
    for line in shared_lines(8):
        padded += [line, "", "    # note", "fi", "}"]
    assert set(duplicates({"a.sh": "\n".join(shared_lines(8)), "b.sh": "\n".join(padded)})) == {"a.sh", "b.sh"}


def test_a_copied_block_raises_the_file_it_came_from_and_the_one_it_went_to_AC_2():
    files = {"a.py": "\n".join(shared_lines(8)), "b.py": "\n".join(["start()", *shared_lines(8)])}
    failures = duplicate_failures(duplicates(files), {})
    assert len(failures) == 2
    assert failures[0].startswith("a.py:") and failures[1].startswith("b.py:")
    assert all("1 " in failure and "held 0" in failure for failure in failures)


def test_held_code_fails_only_when_it_gets_worse_than_its_recorded_level_AC_2():
    held = {"a.py::f": {"lines": 74, "depth": 5}}
    assert function_failures({"a.py::f": {"lines": 74, "depth": 5}}, held) == []
    assert function_failures({"a.py::f": {"lines": 70, "depth": 3}}, held) == []
    failures = function_failures({"a.py::f": {"lines": 75, "depth": 5}}, held)
    assert len(failures) == 1 and "75" in failures[0] and "recorded 74" in failures[0]
    found = {"a.py": [(1, "b.py", 1), (5, "b.py", 9)]}
    assert duplicate_failures(found, {"a.py": 2, "b.py": 2}) == []
    assert len(duplicate_failures(found, {"a.py": 1, "b.py": 2})) == 1


def test_a_held_entry_whose_function_is_gone_reports_nothing_AC_2():
    assert function_failures({}, {"a.py::gone": {"lines": 90, "depth": 6}}) == []
    assert duplicate_failures({}, {"gone.py": 4}) == []


def test_a_function_is_checked_against_its_own_entry_not_its_namesakes_AC_2():
    source = "class C:\n" + python_function("value", 70, "    ") + python_function("value", 65, "    ")
    measured = {f"a.py::{k}": v for k, v in python_functions(source).items()}
    held = {"a.py::C.value": {"lines": 70}, "a.py::C.value#2": {"lines": 30}}
    failures = function_failures(measured, held)
    assert len(failures) == 1
    assert "a.py::C.value#2" in failures[0] and "65" in failures[0] and "recorded 30" in failures[0]


def test_a_match_statement_is_one_level_and_does_not_stop_the_measurer_AC_1():
    source = "def pick(x):\n    match x:\n        case 1:\n            if x:\n                return 1\n"
    assert python_functions(source)["pick"] == {"lines": 5, "depth": 2}


def test_a_bash_function_with_its_brace_on_the_next_line_is_measured_AC_1():
    body = "\n".join(f"  echo {i}" for i in range(MAX_LINES + 3))
    measured = bash_functions(f"f()\n{{\n{body}\n}}\nfunction g\n{{\n  :\n}}\n")
    assert measured["f"]["lines"] == MAX_LINES + 6
    assert measured["g"] == {"lines": 4, "depth": 0}
    assert len(function_failures({f"a.sh::{k}": v for k, v in measured.items()}, {})) == 1
