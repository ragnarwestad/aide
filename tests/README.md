# Testing Guide for doc-aide

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Kjøre tester](#kjøre-tester)
    - [Alle tester](#alle-tester)
    - [Spesifikke test-kategorier](#spesifikke-test-kategorier)
    - [Spesifikk testfil](#spesifikk-testfil)
- [Test-struktur](#test-struktur)
- [Fixtures](#fixtures)
    - [`mock_workspace`](#mock_workspace)
    - [`mock_jira_response`](#mock_jira_response)
    - [`clean_env`](#clean_env)
    - [`workspace_root`](#workspace_root)
    - [`e2e_workspace`](#e2e_workspace)
- [Legge til nye tester](#legge-til-nye-tester)
    - [1. Analyser eksisterende kode](#1-analyser-eksisterende-kode)
    - [2. Skriv test som verifiserer oppførsel](#2-skriv-test-som-verifiserer-oppførsel)
    - [3. Kjør testen](#3-kjør-testen)
    - [4. Verifiser coverage](#4-verifiser-coverage)
- [Best practices](#best-practices)
    - [Mock eksterne avhengigheter](#mock-eksterne-avhengigheter)
    - [Bruk temporary directories](#bruk-temporary-directories)
    - [Isoler environment variables](#isoler-environment-variables)
    - [Test både success og error cases](#test-både-success-og-error-cases)
- [Troubleshooting](#troubleshooting)
    - [Tests feiler med "ModuleNotFoundError"](#tests-feiler-med-modulenotfounderror)
    - [Coverage rapport mangler filer](#coverage-rapport-mangler-filer)
    - [Tests henger (watch mode)](#tests-henger-watch-mode)
- [E2E Tests med CLI Headless Mode](#e2e-tests-med-cli-headless-mode)
    - [Kjøre E2E tester](#kjøre-e2e-tester)
    - [Headless mode per CLI](#headless-mode-per-cli)
    - [Verifisering av resultater](#verifisering-av-resultater)
    - [Viktig om E2E-tester](#viktig-om-e2e-tester)
- [CI/CD](#cicd)
- [Målsetning](#målsetning)
- [Ressurser](#ressurser)

## Oversikt

Dette test-suiten verifiserer funksjonaliteten til doc-aide verktøyet, inkludert:

- Core scripts (`aide-generate-pdf`, `aide-generate-html`, `mise-upgrade-ai-tools`)
- Implementation-spesifikke kommandoer (Claude Code, Codex, Copilot)
- Template-systemet og placeholder-replacement
- Environment variable håndtering
- Dokumentasjonsstruktur og output-validering

## Kjøre tester

**Først, aktiver virtual environment:**

```bash
source .venv/bin/activate
```

Du får da `(venv)` foran prompten. Alternativt kan du kjøre `.venv/bin/pytest` direkte.

### Alle tester

```bash
# Alle tester
pytest

# Med verbose output
pytest -v

# Med coverage rapport
pytest --cov=. --cov-report=html
```

### Spesifikke test-kategorier

```bash
# Core script tests (aide-generate-pdf, aide-generate-html)
pytest tests/specs/unit/core -v

# Implementation-spesifikke tests
pytest tests/specs/unit/implementations -v

# Kun Claude Code tests
pytest tests/specs/unit/implementations/claude-code -v

# Kun validation tests
pytest tests/specs/unit/core/validation -v
```

### Pytest-markører

**Merk:** E2E- og evaluation-tester er **ekskludert fra standard `pytest`-kjøring** fordi de gjør ekte API-kall som
koster penger og tar lang tid.

```bash
# Standard kjøring (ekskluderer e2e og evaluation)
pytest

# Kjør E2E-tester (krever CLI installert + autentisering)
pytest -m e2e

# Kjør E2E for spesifikk implementasjon
pytest -m "e2e and gemini"
pytest -m "e2e and claude_code"
pytest -m "e2e and copilot"
pytest -m "e2e and codex"

# Kjør evaluation-tester (validerer prompts via API)
pytest -m evaluation

# Kjør ALLE tester (inkludert e2e og evaluation)
pytest -m ""

# Andre nyttige markører
pytest -m unit -v              # Alle unit tests
pytest -m integration -v       # Integrasjonstester
pytest -m validation -v        # Alle validation tests
pytest -m claude_code -v       # Claude Code-spesifikke
pytest -m codex -v             # Codex-spesifikke
pytest -m copilot -v           # Copilot-spesifikke
pytest -m gemini -v            # Gemini-spesifikke
```

**Tilgjengelige markører** (definert i `pytest.ini`):

| Markør            | Beskrivelse                                                    |
|-------------------|----------------------------------------------------------------|
| `unit`            | Unit tests (raske, ingen eksterne avhengigheter)               |
| `integration`     | Integrasjonstester (krever full workspace)                     |
| `validation`      | Validering av output-kvalitet                                  |
| `e2e`             | End-to-end tester via CLI headless mode (trege, koster penger) |
| `evaluation`      | Evaluerer prompts via AI API (trege, koster penger)            |
| `claude_code`     | Claude Code-spesifikke tester                                  |
| `codex`           | Codex-spesifikke tester                                        |
| `copilot`         | Copilot-spesifikke tester                                      |
| `gemini`          | Gemini-spesifikke tester                                       |
| `implementations` | Cross-implementation paritetstester                            |

### Spesifikk testfil

```bash
pytest tests/specs/unit/core/test_jira_opprett.py -v

# Enkelt test
pytest tests/specs/unit/core/test_jira_opprett.py::TestFetchJiraData::test_fetch_jira_data_success -v
```

## Test-struktur

```text
tests/
├── specs/
│   ├── unit/                                 # Unit tests (raske, ingen API-kall)
│   │   ├── core/                             # Core script tests
│   │   │   ├── validation/                   # Output validation
│   │   │   │   ├── test_documentation_structure.py
│   │   │   │   └── test_templates.py
│   │   │   ├── test_jira_opprett.py
│   │   │   └── test_todo_opprett.py
│   │   │
│   │   └── implementations/                  # Implementation-spesifikke tests
│   │       ├── claude-code/
│   │       ├── codex/
│   │       ├── copilot/
│   │       └── gemini_impl/
│   │
│   ├── integration/                          # Integrasjonstester
│   │   └── claude_code/                      # Claude Code integrasjon
│   │
│   ├── e2e/                                  # End-to-end tester (ekskludert fra standard kjøring)
│   │   ├── test_claude_e2e.py                # Claude Code: Tester slash-kommandoer (/aide-create, /aide-analyze)
│   │   ├── test_codex_e2e.py                 # Codex: Tester prompts via `codex exec --full-auto`
│   │   └── test_copilot_e2e.py               # Copilot: Tester prompts fra implementations/copilot/prompts/
│   │
│   └── evaluation/                           # Prompt-evaluering via API (ekskludert)
│
├── utils/                                    # Delte test-utilities
│   └── shared_assertions.py
│
└── conftest.py                               # Pytest fixtures
```

## Fixtures

### `mock_workspace`

Oppretter en komplett mock workspace-struktur med templates.

```python
def test_something(mock_workspace):
    # mock_workspace er en tmp_path med full struktur
    assert (mock_workspace / "core" / "templates").exists()
```

### `mock_jira_response`

Mock JIRA API response data.

```python
def test_jira_parsing(mock_jira_response):
    # mock_jira_response inneholder typisk JIRA JSON
    assert mock_jira_response["key"] == "PROJ-TEST-001"
```

### `clean_env`

Cleaner environment variables før test (isolering).

```python
def test_env_vars(clean_env, monkeypatch):
    # Environment er clean, kan sette egne verdier
    monkeypatch.setenv("AIDE_INSTALLATION_PATH", "/test/path")
```

### `workspace_root`

Returnerer faktisk workspace root path.

```python
def test_real_workspace(workspace_root):
    # workspace_root peker til faktisk doc-aide/
    assert (workspace_root / "core" / "scripts").exists()
```

### `e2e_workspace`

Oppretter en isolert workspace for E2E-tester med nødvendig struktur.

```python
@pytest.mark.e2e
def test_aide_workflow(e2e_workspace, workspace_root):
    # e2e_workspace er en tmp_path med core/ og reports/ struktur
    # Miljøvariabler settes automatisk til e2e_workspace
    reports_path = e2e_workspace / "reports"
    assert reports_path.exists()
```

## Legge til nye tester

### 1. Analyser eksisterende kode

Før du skriver tester, forstå hvordan koden faktisk fungerer:

```bash
# Les scriptet
cat core/scripts/aide-generate-pdf

# Test manuelt (se scriptets egen bruksinfo)
./core/scripts/aide-generate-pdf
```

### 2. Skriv test som verifiserer oppførsel

```python
import pytest


@pytest.mark.unit
def test_my_function(mock_workspace):
    """Test that my_function does what it should."""
    # Arrange
    expected_result = "something"

    # Act
    result = my_function()

    # Assert
    assert result == expected_result
```

### 3. Kjør testen

```bash
pytest tests/unit/test_my_module.py -v
```

### 4. Verifiser coverage

```bash
pytest tests/unit/test_my_module.py --cov=core.scripts.my_module --cov-report=term
```

## Best practices

### Mock eksterne avhengigheter

```python
from unittest.mock import Mock, patch


@patch('subprocess.run')
def test_with_subprocess_mock(mock_run):
    mock_run.return_value = Mock(returncode=0, stdout="success")
    # Test kode som kaller subprocess.run
```

### Bruk temporary directories

```python
def test_file_operations(tmp_path):
    # tmp_path er en temporær mappe som slettes etter test
    test_file = tmp_path / "test.txt"
    test_file.write_text("content")
    assert test_file.read_text() == "content"
```

### Isoler environment variables

```python
def test_env_handling(monkeypatch):
    monkeypatch.setenv("MY_VAR", "test_value")
    # Test kode som bruker MY_VAR
    # Environment er tilbakestilt etter test
```

### Test både success og error cases

```python
def test_success_case():
    result = my_function(valid_input)
    assert result is not None


def test_error_case():
    with pytest.raises(ValueError):
        my_function(invalid_input)
```

## Troubleshooting

### Tests feiler med "ModuleNotFoundError"

Kjør pytest fra workspace root:

```bash
cd /path/to/doc-aide
pytest
```

### Coverage rapport mangler filer

Sjekk `pytest.ini` - cov paths må matche faktisk struktur:

```ini
[pytest]
addopts =
    --cov=core
```

### Tests henger (watch mode)

Alltid bruk pytest uten watch mode i CI/CD:

```bash
pytest  # IKKE pytest-watch
```

## E2E Tests med CLI Headless Mode

Alle AI CLI-verktøy støtter headless mode som gjør det mulig å kjøre ekte end-to-end tester.

**Merk:** E2E-tester er ekskludert fra standard `pytest`-kjøring. Se [Pytest-markører](#pytest-markører).

### Kjøre E2E tester

```bash
# Alle E2E tester
pytest -m e2e

# Per implementasjon
pytest -m "e2e and claude_code"
pytest -m "e2e and gemini"
pytest -m "e2e and copilot"
pytest -m "e2e and codex"
```

### Headless mode per CLI

| CLI         | Headless flag      | Status     | Eksempel                                                |
|-------------|--------------------|------------|---------------------------------------------------------|
| Claude Code | `-p`               | ✅ Fungerer | `claude -p "prompt" --allowedTools "Bash,Read,Write"`   |
| Copilot     | `-p`               | ✅ Fungerer | `copilot -p "prompt" --allow-all-tools`                 |
| Codex       | `exec --full-auto` | ✅ Fungerer | `codex exec --full-auto --skip-git-repo-check "prompt"` |
| Gemini      | `-p`               | ❌ Fjernet  | CLI henger etter prompt, ingen E2E-tester               |

### Claude Code

```bash
# Headless mode
claude -p "prompt" --allowedTools "Bash,Read,Write"

# Med JSON output
claude -p "prompt" --output-format json
claude -p "prompt" --output-format stream-json
```

### Gemini CLI

**⚠️ Merk:** Gemini CLI støtter ikke ekte headless mode. CLI-en henger etter å ha fullført prompten og avslutter ikke
automatisk. E2E-tester for Gemini er derfor skipped.

```bash
# Headless mode (henger - bruk ikke i automatiserte tester)
gemini -p "prompt"

# YOLO mode (ingen bekreftelser, men henger fortsatt)
gemini -p "prompt" --yolo
```

### GitHub Copilot CLI

```bash
# Headless mode
copilot -p "prompt"

# Med tool-tillatelser
copilot -p "prompt" --allow-tool "shell(bash)"
copilot -p "prompt" --allow-all-tools
```

### OpenAI Codex CLI

```bash
# Exec mode (headless) - krever --full-auto for automatisk kjøring
codex exec --full-auto --skip-git-repo-check "prompt"

# Med output til fil
codex exec --full-auto -o result.txt "prompt"

# Med JSON output (for parsing)
codex exec --full-auto --json "prompt"
```

### Eksempel E2E test

```python
@pytest.mark.e2e
@pytest.mark.claude_code
def test_claude_headless_basic():
    """Test basic Claude headless mode execution."""
    result = subprocess.run(
        ["claude", "-p", "Say 'hello' and nothing else",
         "--output-format", "json"],
        capture_output=True, text=True, timeout=30
    )
    assert result.returncode == 0
    assert len(result.stdout) > 0
```

### Verifisering av resultater

I headless mode kan du verifisere resultater på flere måter:

**1. Exit code**

```bash
claude -p "Create file" && echo "Success" || echo "Failed"
```

**2. JSON output parsing**

```bash
result=$(claude -p "Say hello" --output-format json)
echo "$result" | jq '.result'
```

**3. Sjekke side-effekter (filer opprettet)**

```python
# Kjør kommando
subprocess.run(["claude", "-p", "/aide-create TODO test Description"])

# Verifiser at filer ble opprettet
assert (reports_dir / "todo-01-test" / "1-description.md").exists()
```

**4. Komplett eksempel med alle verifiseringer**

```python
@pytest.mark.e2e
def test_aide_workflow_creates_files(tmp_path, monkeypatch):
    """Verifiser at workflow oppretter forventede filer."""
    monkeypatch.setenv("AIDE_INSTALLATION_PATH", str(tmp_path))
    (tmp_path / "reports" / "todo").mkdir(parents=True)

    # Kjør kommando
    result = subprocess.run(
        ["claude", "-p", "/aide-create TODO test-task Description",
         "--output-format", "json"],
        capture_output=True, text=True, timeout=120,
        cwd=str(tmp_path)
    )

    # 1. Verifiser exit code
    assert result.returncode == 0, f"Failed: {result.stderr}"

    # 2. Verifiser output (ikke tom)
    assert len(result.stdout) > 0, "No output"

    # 3. Verifiser side-effekter (filer opprettet)
    todo_dirs = list((tmp_path / "reports" / "todo").glob("TODO-*"))
    assert len(todo_dirs) >= 1, "No TODO directory created"

    expected_files = ["1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"]
    for filename in expected_files:
        assert (todo_dirs[0] / filename).exists(), f"Missing: {filename}"
```

### Viktig om E2E-tester

- **Koster penger** - bruker faktiske API-kall
- **Trege** - kan ta 30-120 sekunder per test
- **Krever autentisering** - CLI må være installert og autentisert
- **Ekskludert fra standard kjøring** - må kjøres eksplisitt med `-m e2e`

## CI/CD

**Merk:** Det er foreløpig ingen CI/CD-pipeline konfigurert for dette prosjektet.

For å sette opp GitHub Actions, opprett `.github/workflows/test.yml`:

```yaml
# Eksempel - ikke implementert ennå
name: Tests
on: [ push, pull_request ]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt
      - run: pytest -v --cov=. --cov-report=xml
```

## Målsetning

- **Coverage:** Minimum 80% for Python scripts
- **Hastighet:** Unit tests < 1 sekund hver
- **Isolasjon:** Ingen tester skal avhenge av andre
- **Repeatability:** Samme resultat hver gang

## Ressurser

### Testing

- [Pytest Documentation](https://docs.pytest.org/)
- [Python unittest.mock](https://docs.python.org/3/library/unittest.mock.html)
- [Coverage.py](https://coverage.readthedocs.io/)

### Implementasjoner

Se README for hver implementasjon for CLI-dokumentasjon og headless mode:

- [Claude Code](../implementations/claude-code/README.md)
- [Gemini CLI](../implementations/gemini/README.md)
- [GitHub Copilot CLI](../implementations/copilot/README.md)
- [OpenAI Codex CLI](../implementations/codex/README.md)
