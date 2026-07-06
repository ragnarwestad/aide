# AI Development Guide

## Innholdsfortegnelse

- [Arkitekturprinsipper](#arkitekturprinsipper)
  - [AI-agnostisk design](#ai-agnostisk-design)
  - [Lagdelt arkitektur](#lagdelt-arkitektur)
- [Design patterns i bruk](#design-patterns-i-bruk)
  - [Pattern 21: Tool Calling](#pattern-21-tool-calling)
  - [Pattern 22: Code Execution](#pattern-22-code-execution)
  - [Pattern 23: Multi-agent Collaboration](#pattern-23-multi-agent-collaboration)
  - [Pattern 13: Chain of Thought](#pattern-13-chain-of-thought)
  - [Pattern 6: Basic RAG](#pattern-6-basic-rag-retrieval-augmented-generation)
  - [Pattern 17: Reflection](#pattern-17-reflection)
- [AI best practices](#ai-best-practices)
  - [Fra Anthropic: Claude Code Best Practices](#fra-anthropic-claude-code-best-practices)
  - [Fra OpenAI: Best Practices for Prompt Engineering](#fra-openai-best-practices-for-prompt-engineering)
  - [Fra GitHub: Copilot Best Practices](#fra-github-copilot-best-practices)
- [Ressurser og inspirasjon](#ressurser-og-inspirasjon)
  - [Generative AI Design Patterns](#generative-ai-design-patterns)
  - [Anthropic Resources](#anthropic-resources)
  - [OpenAI Resources](#openai-resources)
  - [Andre ressurser](#andre-ressurser)
- [Implementasjonsdetaljer](#implementasjonsdetaljer)
  - [Hvorfor 4-fils dokumentstruktur?](#hvorfor-4-fils-dokumentstruktur)
  - [Hvorfor slash commands (Claude Code)?](#hvorfor-slash-commands-claude-code)
  - [Hvorfor TDD-tilnærming?](#hvorfor-tdd-tilnærming)
  - [Hvorfor AI-agnostisk design?](#hvorfor-ai-agnostisk-design)
- [Bidra til prosjektet](#bidra-til-prosjektet)
  - [Legge til ny AI-implementasjon](#legge-til-ny-ai-implementasjon)
  - [Legge til ny design pattern](#legge-til-ny-design-pattern)
  - [Oppdatere best practices](#oppdatere-best-practices)

---

## Arkitekturprinsipper

### AI-agnostisk design

**Kjerneprinsipp:** Skill generisk innhold fra AI-spesifikk implementasjon.

**Struktur:**

```text
core/                    # AI-agnostic (workflows, docs, scripts)
implementations/         # AI-specific (claude-code, codex, copilot)
reports/                 # Output (AI-agnostic)
```

**Hvorfor:**
- Ikke låst til én AI-leverandør
- Enkel å legge til nye AI-verktøy
- Gjenbruk av workflows, templates og scripts
- Team kan velge beste verktøy for hver oppgave

**Se:** [README.md](../README.md#arkitektur)

### Lagdelt arkitektur

| Lag                  | Ansvar                                    | Eksempel                           |
|----------------------|-------------------------------------------|------------------------------------|
| **Core**             | Workflows, standards, data                | `core/rules/workflows.md`           |
| **Implementation**   | AI-spesifikke kommandoer/instruksjoner    | `implementations/claude-code/`     |
| **Scripts**          | CLI-verktøy                               | `core/scripts/`                         |
| **Templates**        | Dokumentstrukturer                        | `core/templates/todo/`             |
| **Output**           | Generert dokumentasjon og analyse         | `reports/<NN>-PROJ-XXXX-slug/`       |

---

## Design patterns i bruk

Dette prosjektet er inspirert av [Lakshman Oruganti's Generative AI Design Patterns](https://github.com/lakshmanok/generative-ai-design-patterns) (O'Reilly bok).

### Pattern 21: Tool Calling

**Konsept:** LLM-er sender spesielle tokens for å kalle API-er med parametere. En postprocessor kjører funksjonen og returnerer resultater til modellen.

**Vår implementasjon:**
- Claude Code slash commands: `/aide-create`, `/aide-analyze`, `/aide-implement`
- AI-verktøy kaller scripts og leser JIRA-data fra bruker → Genererer dokumentasjon

**Eksempel:**
```bash
# Claude Code oppretter dokumentstruktur
/aide-create PROJ-7890
  ↓
Bruker limer inn JIRA-data  # Data kopieres manuelt fra JIRA-nettleseren
  ↓
AI fyller ut 1-description.md med metadata og problembeskrivelse
```

**Hvorfor:** Gir AI-verktøy tilgang til eksterne systemer (git, kodebase) via tool calling.

### Pattern 22: Code Execution

**Konsept:** AI-agenter genererer kode som kjøres av eksterne systemer.

**Vår implementasjon:**
- AI genererer tester (RED)
- AI implementerer løsning (GREEN)
- Bash-kommandoer kjører `pnpm test`, `pnpm run build`
- AI tolker output og itererer

**Eksempel:**
```typescript
// AI genererer test
test('validateSøknad should reject invalid personnummer', () => {
  expect(validateSøknad({ personnummer: '12345678901' })).toBe(false)
})

// Kjører testen
pnpm test -- validateSøknad  # Test feiler (RED)

// AI implementerer løsning
function validateSøknad(data) {
  return isValidPersonnummer(data.personnummer)
}

// Kjører testen igjen
pnpm test -- validateSøknad  # Test passerer (GREEN)
```

**Hvorfor:** TDD-tilnærming gir AI et klart mål (test som skal passere) i stedet for vage beskrivelser.

### Pattern 23: Multi-agent Collaboration

**Konsept:** Spesialiserte enkeltstående agenter organisert i hierarkiske strukturer.

**Vår implementasjon (Claude Code):**
- `task-analyzer` - Analyserer JIRA-saker og TODO-planer, detekterer kompleksitet
- `tdd-implementer` - Implementerer løsninger med TDD (RED → GREEN → REFACTOR)
- `test-coverage-improver` - Lager manglende enhetstester
- `react-class-to-functional-converter` - Konverterer React class til functional components
- `redux-form-analyzer` - Analyserer Redux Form for migrering

**Hvorfor:** Spesialiserte agenter er bedre på spesifikke oppgaver enn én generalist-agent.

**Se:** [implementations/claude-code/README.md](../implementations/claude-code/README.md)

### Pattern 13: Chain of Thought

**Konsept:** Bryt komplekse problemer i mellomsteg før endelig svar.

**Vår implementasjon:**
- **Explore** → Les relevante filer, forstå struktur
- **Plan** → Tenk gjennom tilnærminger, identifiser edge cases
- **Code** → Implementer med TDD (RED → GREEN → REFACTOR)
- **Commit** → Verifiser og commit

**Hvorfor:** AI som hopper rett til koding uten å forstå problemet gir dårligere resultater.

**Se:** [workflows.md](../core/rules/workflows.md)

### Pattern 6: Basic RAG (Retrieval-Augmented Generation)

**Konsept:** Grunn responser ved å legge til relevant knowledge base informasjon i prompts.

**Vår implementasjon:**
- Testing-regler: `core/rules/testing.md`
- Workflows: `core/rules/workflows.md`
- AI leser relevante dokumenter før generering

**Eksempel:**

```text
User: "Legg til behandlingsstatus felt i saksoversikt"
  ↓
AI søker i kodebasen etter API-kallet
  ↓
AI finner: GET /api/sak/{sakId} → my-api/.../SakController.java:156
  ↓
AI konkluderer: Må endre både frontend (my-app) og backend (my-api)
```

**Hvorfor:** Grounding reduserer hallusinasjoner og sikrer at AI jobber med faktisk kodebase-struktur.

### Pattern 17: Reflection

**Konsept:** AI evaluerer og forbedrer egne output.

**Vår implementasjon:**
- 4-fils dokumentstruktur: `1-description.md`, `2-analysis.md`, `3-solution.md`, `4-status.md`
- AI kan kjøre `/aide-analyze` på nytt etter kodeendringer
- AI oppdaterer `4-status.md` underveis i implementering

**Hvorfor:** Iterativ forbedring av analyse og plan gir bedre resultater enn one-shot generering.

---

## AI best practices

### Fra Anthropic: Claude Code Best Practices

**Kilde:** [Anthropic Engineering Blog](https://www.anthropic.com/engineering/claude-code-best-practices)

**Nøkkelpunkter:**

1. **Explore → Plan → Code → Commit workflow**
   - Steg 1-2 er kritiske - uten dem hopper AI rett til koding
   - Allerede innebygd i `core/rules/workflows.md`

2. **Test-Driven Development**
   - Iterere mot et klart mål (test som skal passere)
   - Allerede innebygd i `3-solution.md` TDD-tilnærming

3. **Visuell iterasjon**
   - Bruk screenshots og design mocks
   - Lagt til i `core/rules/documentation.md` (assets-mapper)

4. **Context management**
   - Bruk `/clear` mellom uavhengige oppgaver
   - Lagt til i `core/rules/workflows.md` (Workflow-optimalisering)

5. **Spesifikke instruksjoner**
   - Detaljerte beskrivelser gir betydelig høyere suksessrate
   - Lagt til i `core/rules/documentation.md` (Best practices)

**Se:** [documentation.md](../core/rules/documentation.md#best-practices-for-ai-assistert-dokumentasjon) og [workflows.md](../core/rules/workflows.md#workflow-optimalisering)

### Fra OpenAI: Best Practices for Prompt Engineering

**Prinsipper:**

1. **Write clear instructions**
   - Allerede implementert: Detaljerte templates i `core/templates/`
   - Spesifikke instruksjoner i `CLAUDE.md`, `copilot-instructions.md`

2. **Provide reference text**
   - Allerede implementert: `core/rules/`
   - AI leser dokumentasjon før generering (RAG-pattern)

3. **Split complex tasks into simpler subtasks**
   - Allerede implementert: 4-fils dokumentstruktur
   - Fase-basert implementering (Opprett → Analyser → Løs → Verifiser)

4. **Give the model time to "think"**
   - Allerede implementert: Explore og Plan faser før Code
   - AI-spesifikke "deep thinking" funksjoner kan aktiveres ved behov

### Fra GitHub: Copilot Best Practices

**Prinsipper:**

1. **Use descriptive function names**
   - Implementert: Navnekonvensjoner i `KODESTANDARD.md`

2. **Provide context through comments**
   - Implementert: Før/etter eksempler i `3-solution.md`

3. **Break down large functions**
   - Implementert: Refaktorering-retningslinjer i `KODESTANDARD.md`

---

## Ressurser og inspirasjon

### Generative AI Design Patterns

**Repo:** [lakshmanok/generative-ai-design-patterns](https://github.com/lakshmanok/generative-ai-design-patterns)

**Bok:** "Generative AI Design Patterns" (O'Reilly)

**32 patterns organisert i kategorier:**

1. **Patterns 1-5:** Prompt engineering basics
2. **Patterns 6-12:** Knowledge & context management (RAG, semantic search)
3. **Patterns 13-16:** Reasoning & decision-making (Chain of Thought, Tree of Thoughts)
4. **Patterns 17-20:** Reliability & safety (LLM-as-Judge, reflection, guardrails)
5. **Patterns 21-23:** Agent action & tool orchestration ⭐ (Tool Calling, Code Execution, Multi-agent)
6. **Patterns 24-32:** Advanced patterns (template generation, etc.)

**Hvilke patterns vi bruker:**
- Pattern 6: Basic RAG (API-mapping, dokumentasjon)
- Pattern 13: Chain of Thought (Explore → Plan → Code)
- Pattern 17: Reflection (iterativ forbedring av analyse)
- Pattern 21: Tool Calling (JIRA API, git, scripts)
- Pattern 22: Code Execution (TDD-testing)
- Pattern 23: Multi-agent Collaboration (spesialiserte agents)

### Anthropic Resources

**Claude Code Best Practices:**
- [Blog post](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Dokumentasjon](https://docs.claude.com/en/docs/claude-code)

**Prompt Engineering:**
- [Prompt Engineering Guide](https://docs.anthropic.com/claude/docs/prompt-engineering)
- [System Prompts](https://docs.anthropic.com/claude/docs/system-prompts)

### OpenAI Resources

**Best Practices:**
- [Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [GPT Best Practices](https://platform.openai.com/docs/guides/gpt-best-practices)

**Function Calling:**
- [Function Calling Guide](https://platform.openai.com/docs/guides/function-calling)

### Andre ressurser

**AI Agent Frameworks:**
- [LangChain](https://www.langchain.com/) - Framework for building AI applications
- [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT) - Autonomous agents
- [BabyAGI](https://github.com/yoheinakajima/babyagi) - Task-driven autonomous agent

**Testing AI Systems:**
- [OpenAI Evals](https://github.com/openai/evals) - Framework for evaluating AI systems
- [Promptfoo](https://www.promptfoo.dev/) - Test and evaluate LLM output quality

---

## Implementasjonsdetaljer

### Hvorfor 4-fils dokumentstruktur?

**Design-valg:**
- `1-description.md` - Problembeskrivelse (read-only etter opprettelse)
- `2-analysis.md` - Kodebase-analyse (kan kjøres på nytt)
- `3-solution.md` - Implementeringsplan (iterativt forbedret)
- `4-status.md` - Fremdriftssporing (oppdateres kontinuerlig)

**Hvorfor 4 filer, ikke én stor fil?**
1. **Separasjon av bekymringer:** Hver fil har ett ansvar
2. **Re-entrancy:** `2-analysis.md` kan regenereres uten å overskrive `1-description.md`
3. **Lesbarhet:** Mennesker leser `1-description.md` → `2-analysis.md` → `3-solution.md`
4. **AI-parsing:** AI kan lese én fil av gangen (reduserer token-bruk)

**Inspirert av:** Software engineering best practices (Single Responsibility Principle)

### Hvorfor slash commands (Claude Code)?

**Design-valg:**
- `/aide-create PROJ-XXXX` - Opprett dokumentstruktur
- `/aide-analyze PROJ-XXXX` - Analyser kodebase
- `/aide-implement PROJ-XXXX` - Implementer løsning

**Hvorfor slash commands, ikke naturlig språk?**
1. **Presisjon:** Unngår tvetydighet (vs. "analyser denne saken")
2. **Konsistens:** Samme kommando gir samme resultat
3. **Discoverability:** `/` viser alle tilgjengelige kommandoer
4. **Composability:** Kan kalle commands fra andre commands

**Alternativ (GitHub Copilot/Codex):** Prompt-templates i `implementations/copilot/prompts/` og `implementations/codex/prompts/`

### Hvorfor TDD-tilnærming?

**Design-valg:** RED → GREEN → REFACTOR

**Hvorfor TDD for AI-assistert utvikling?**
1. **Klart mål:** AI har konkret target (test som skal passere)
2. **Verifiserbarhet:** AI kan kjøre tester og se om de passerer
3. **Iterasjon:** AI kan iterere til testene passerer
4. **Regresjons-sikkerhet:** Full test-suite kjøres etter implementering

**Inspirert av:** Test-Driven Development (Kent Beck)

### Hvorfor AI-agnostisk design?

**Design-valg:** Skill `core/` fra `implementations/`

**Hvorfor ikke én AI-spesifikk implementasjon?**
1. **Resiliens:** Ikke låst til én leverandør (hvis Claude har nedetid, bruk Codex/Copilot)
2. **Fleksibilitet:** Velg beste verktøy for hver oppgave
3. **Læring:** Sammenlign hvordan ulike AI-verktøy håndterer samme oppgaver
4. **Fremtidssikker:** Enkel å legge til nye AI-verktøy

**Trade-off:** Mer kompleks struktur, men betydelig mer robust og fleksibel.

---

## Bidra til prosjektet

### Legge til ny AI-implementasjon

1. **Opprett katalog:** `implementations/<ai-tool>/`
2. **Opprett README.md:** Setup-guide og quick start
3. **Legg til instruksjons-/konfigfiler** for verktøyet:
   - Claude Code: skills i `core/skills/`, regler i `core/rules/`, agenter i `implementations/claude-code/agents/`
   - Copilot: `core/AGENTS.md` → `~/.copilot/copilot-instructions.md` (genereres via `core/scripts/build-agents-md.sh`)
   - Codex: `core/AGENTS.md` → `~/.codex/AGENTS.md`, pluss `implementations/codex/config.toml`
   - Gemini: `implementations/gemini/settings.json`
   - Ny AI: tilsvarende format for det verktøyet
4. **Opprett install.sh** etter mønster fra eksisterende implementasjoner
5. **Test workflow:** Opprett → Analyser → Løs → Verifiser

### Legge til ny design pattern

1. **Identifiser pattern:** Hvilken pattern løser hvilket problem?
2. **Dokumenter i denne filen:** Legg til under "Design patterns i bruk"
3. **Implementer:** Oppdater `core/rules/` eller `implementations/`
4. **Test:** Verifiser at pattern fungerer i praksis

### Oppdatere best practices

1. **Finn ny ressurs:** Blog post, forskningsartikkel, dokumentasjon
2. **Evaluer relevans:** Passer det med prosjektets arkitektur?
3. **Dokumenter her:** Legg til under "AI best practices"
4. **Implementer:** Oppdater relevante filer (`core/rules/workflows.md`, `core/rules/documentation.md`)

---

## Se også

- [README.md](../README.md) - Prosjektets hovedside
- [workflows.md](../core/rules/workflows.md) - JIRA-sak og TODO-plan workflows
- [documentation.md](../core/rules/documentation.md) - Dokumentasjonsstandard
- [implementations/claude-code/README.md](../implementations/claude-code/README.md) - Claude Code-implementasjon
