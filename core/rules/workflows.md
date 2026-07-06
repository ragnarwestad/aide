# Workflows for AI-assistert utvikling

## Innholdsfortegnelse

- [Kompleksitetsdeteksjon](#kompleksitetsdeteksjon)
  - [LAV kompleksitet (Quick Fix)](#lav-kompleksitet-quick-fix)
  - [MIDDELS kompleksitet](#middels-kompleksitet)
  - [HOY kompleksitet](#høy-kompleksitet)
- [Problemtype-routing (Quick Reference)](#problemtype-routing-quick-reference)
- [Branch-strategi](#branch-strategi)
- [JIRA-sak workflow](#jira-sak-workflow)
  - [Fase 1: Opprett dokumentstruktur](#fase-1-opprett-dokumentstruktur)
  - [Fase 2: Analyser kodebase](#fase-2-analyser-kodebase)
  - [Fase 3: Implementer løsning](#fase-3-implementer-løsning)
  - [Fase 4: Verifiser](#fase-4-verifiser)
- [TODO-plan workflow](#todo-plan-workflow)
- [API-påvirkningsanalyse](#api-påvirkningsanalyse)
- [Tverrfaglige saker](#tverrfaglige-saker)
- [Workflow-optimalisering](#workflow-optimalisering)

---

## Kompleksitetsdeteksjon

**Prinsipp:** Match dokumentasjonens omfang til oppgavens kompleksitet.

### LAV kompleksitet (Quick Fix)

**Kjennetegn:**
- Beskrivelsen nevner **én spesifikk fil**
- Enkle operasjoner: "fjern", "erstatt", "rett", "oppdater", "fikse"
- Påvirker 1-2 filer totalt

**Analyse-scope:**
- Les KUN den nevnte filen
- IKKE søk i hele kodebasen

**Dokumentasjon:** Kort og konsis (< 200 linjer totalt)
**Estimat:** Minutter til timer (< 2 timer)

**Eksempler:**
- "Fjern console.log fra src/services/utils.js"
- "Rett typo i UserProfile.tsx linje 45"

---

### MIDDELS kompleksitet

**Kjennetegn:**
- Beskrivelsen nevner **én komponent/modul**
- Operasjoner: "refaktorer", "forbedre", "moderniser", "utvid"
- Kan påvirke 3-10 filer

**Analyse-scope:**
- Finn filer knyttet til komponenten/modulen
- Finn relaterte tester og brukssteder
- IKKE søk bredere enn nødvendig

**Dokumentasjon:** Moderat detalj (100-300 linjer totalt)
**Estimat:** Timer til dager (2-16 timer)

**Eksempler:**
- "Refaktorer Stegvelger-komponenten"
- "Forbedre error handling i api-layer"

---

### HØY kompleksitet

**Kjennetegn:**
- Beskrivelsen bruker **patterns** ("alle", "migrer X til Y", "oppgrader")
- Store refaktoreringer eller arkitekturendringer
- Påvirker 10+ filer

**Analyse-scope:**
- Søk bredt i kodebasen for patterns
- Kategoriser filer etter kompleksitet
- Analyser API-påvirkning (frontend - backend)
- Identifiser edge cases og risikoer

**Dokumentasjon:** Omfattende analyse (300-800 linjer totalt)
**Estimat:** Dager til uker (1-10 dager)

**Eksempler:**
- "Migrer alle Redux Form-komponenter til react-hook-form"
- "Oppgrader React 17 til React 18"

---

## Problemtype-routing (Quick Reference)

| Problemtype | Start med dokumentasjon | Workflow |
|-------------|------------------------|----------|
| **Frontend UI-bug** | `frontend kodestandard` | Reproduser - Identifiser komponent - Sjekk API - TDD |
| **Backend API-feil** | `backend oversikt` + `patterns.md` | Identifiser endpoint - Sjekk ripple effects - TDD |
| **Tverrfaglig** | `API mapping guide` | Backend først - Test - Frontend - Full stack test |
| **Refaktorering** | `testing-reglene` | Sikre tester - Refaktorer - Verifiser grønne tester |
| **Test-generering** | `testing-reglene` | Les kode - Identifiser edge cases - Skriv tester |
| **Ny funksjonalitet** | `workflows-reglene` | Les JIRA/TODO - Analyser omfang - TDD |
| **Database-endring** | `backend patterns` | Identifiser ripple effects - Flyway - Test |
| **Performance** | `frontend kodestandard` | Profiler - Finn root cause - Benchmark - Optimaliser |

**Hurtigreferanse:**
- **Frontend-problem?** Se `frontend kodestandard`
- **Backend-problem?** Se `backend oversikt` + `patterns.md`
- **Tverrfaglig?** Se `API mapping guide`
- **Testing?** Se `testing-reglene`
- **Git/Commit?** Se `git-reglene`

---

## Branch-strategi

**Før du starter analyse eller implementering:**

AI-assistenten kan jobbe med **flere repositories** samtidig (f.eks. my-app, my-api, etc.). Det er kritisk at riktig branch er sjekket ut i alle relevante repositories.

### Hvorfor dette er viktig

- Analyse-fasen leser API-mapping for å finne hvilke systemer som er involvert
- **Hvis feil branch er sjekket ut**, kan analysen/implementeringen bli feil eller ufullstendig
- AI-assistenten **avbryter med feilmelding** hvis nødvendig repository mangler

### Anbefalt prosedyre

**1. Sjekk ut samme branch i alle relevante repositories:**

```bash
# my-app (frontend)
cd ~/develop/my-app
git checkout feature/PROJ-7637

# my-api (backend)
cd ~/develop/my-api
git checkout feature/PROJ-7637
```

**2. Verifiser at repositories er synkroniserte:**

```bash
cd ~/develop/my-app && git pull
cd ~/develop/my-api && git pull
```

### Sporingsinfo i dokumentasjon

Etter analyse/løsning oppdateres **Sporingsinfo** med hvilke repositories og branches som ble brukt:

```markdown
## Sporingsinfo

- **JIRA:** [PROJ-7637](https://jira.example.com/browse/PROJ-7637)
- **Sist analysert:** `2025-11-07`

**Repositories brukt under analyse:**
- **my-app:** `feature/PROJ-7637` @ `abc123de`
- **my-api:** `feature/PROJ-7637` @ `def456ab`
```

---

## JIRA-sak workflow

### Overordnet flyt
```text
Opprett - Analyser - Løs - Verifiser
```

### Fase 1: Opprett dokumentstruktur

**Hva skal gjøres:**
1. Henter saken fra JIRA API (validering)
2. Tildeler neste ledige nummer og oppretter katalog: `reports/<NN>-PROJ-XXXX-slug/`
3. Fyller ut `1-description.md` med JIRA-metadata
4. Oppretter tomme filer: `2-analysis.md`, `3-solution.md`, `4-status.md`
5. Stager alle nye filer i git (automatisk)

**Output:**
```text
reports/05-PROJ-7894-class-to-functional/
├── 0-README.md            (leserekkefølge)
├── 1-description.md       (ferdig)
├── 2-analysis.md           (⏳ tom)
├── 3-solution.md           (⏳ tom)
└── 4-status.md            (⏳ tom)
```

### Fase 2: Analyser kodebase

**Hva skal gjøres:**
1. Leser `1-description.md`
2. **Detekter kompleksitetsnivå** (se [Kompleksitetsdeteksjon](#kompleksitetsdeteksjon))
3. Analyserer kodebase (konkrete filer + linjenummer)
4. Identifiserer påvirkede prosjekter (frontend, backend, etc.)
5. Vurderer API-påvirkning (se [API-påvirkningsanalyse](#api-påvirkningsanalyse))
6. Oppdaterer alle 4 dokumentfiler

**Kan kjøres på nytt** når kodebasen endres.

### Fase 3: Implementer løsning

**Hva skal gjøres:**
1. Leser `2-analysis.md` og `3-solution.md`
2. Følger TDD-tilnærming:
   - **RED**: Skriver tester som beviser problemet (skal feile)
   - **GREEN**: Implementerer løsningen (testene skal passere)
   - **REFACTOR**: Kjører regresjonstester (verifiserer ingen brudd)
3. Ber om bekreftelse før hver fase
4. Oppdaterer `4-status.md` underveis

### Fase 4: Verifiser

**Manuelt steg:**
1. Kjør alle tester: `pnpm test -- --run`
2. Kjør linting: `pnpm run lint`
3. Bygg applikasjonen: `pnpm run build`
4. Test manuelt i nettleser
5. Kjør `/ultrareview` for skybasert kodegjennomgang av branchen (bruker-trigget, krever git-repo)
6. Commit endringer

---

## TODO-plan workflow

### Overordnet flyt
```text
Opprett - Analyser - Løs - Verifiser
```

### Fase 1: Opprett dokumentstruktur

**Hva skal gjøres:**
1. Tildeler nummer (neste ledige)
2. Oppretter katalog: `reports/<NN>-slug-navn/`
3. Fyller ut `1-description.md` med metadata
4. Oppretter tomme filer: `2-analysis.md`, `3-solution.md`, `4-status.md`
5. Stager alle nye filer i git (automatisk)

**Output:**
```text
reports/17-rydd-opp-i-console-log/
├── 0-README.md            (leserekkefølge)
├── 1-description.md       (ferdig)
├── 2-analysis.md           (⏳ tom)
├── 3-solution.md           (⏳ tom)
└── 4-status.md            (⏳ tom)
```

### Fase 2-4: Analyser, Løs og Verifiser

Samme som [JIRA-sak workflow](#jira-sak-workflow).

---

## API-påvirkningsanalyse

**VIKTIG:** Vurder alltid API-påvirkning når du analyserer en sak!

### Workflow

1. **Les API mapping guide**
   - `API mapping guide`
2. **Identifiser API-kall**
   - Søk etter endpoints i frontend-kode
   - Eksempel: `'api/sak/' + sakId`

3. **Slå opp i mapping**
   - Bruk `API quick reference` for rask lookup
   - Finn eksakt backend-fil og linjenummer

4. **Vurder påvirkning**
   - **Frontend only?** UI-endringer uten API-endring
   - **Backend only?** Logikk-endringer uten kontraktsendring
   - **Both?** Nye felt, validering, endret API-kontrakt

### Eksempel

**JIRA-sak:** "Legg til 'behandlingsstatus' felt i saksoversikt"

**Analyse:**
1. Frontend bruker: `GET /api/sak/{sakId}`
2. Backend-endepunktet ligger i: `my-api/src/.../SakController.java:156`
3. Vurdering: **Both**

**Dokumenter i `2-analysis.md`:**
```markdown
## Påvirkede prosjekter

### my-api
- SakController.java:156 - Legg til `behandlingsstatus` i response
- SakDto.java:42 - Legg til nytt felt

### my-app
- src/sider/sak/SakOversikt.tsx:89 - Vis `behandlingsstatus` i UI
```

---

## Tverrfaglige saker

Mange saker krever endringer i flere prosjekter.

### Workflow for tverrfaglige saker

1. **Analyser** hvilke prosjekter som påvirkes
2. **Dokumenter** i `2-analysis.md`:
   - Liste over påvirkede filer (med linjenummer)
   - Avhengigheter mellom prosjekter
3. **Implementer** i riktig rekkefølge:
   - Ofte: Backend først, deretter frontend
   - Årsak: Frontend avhenger av backend API-kontrakt
4. **Test** hele flyten:
   - Backend-tester (unit + integration)
   - Frontend-tester (unit + e2e)
   - Manuell testing (full stack)

---

## Workflow-optimalisering

Basert på [Anthropics offisielle guide](https://www.anthropic.com/engineering/claude-code-best-practices).

### Context management

**Bruk `/clear` mellom uavhengige oppgaver:**
- Holder ytelsen oppe
- Forhindrer at tidligere kontekst distraherer

**Når bruke /clear:**
- Etter fullført JIRA-sak eller TODO-plan
- Når du bytter mellom uavhengige oppgaver

### Course correction

**Interrupt og omstyring:**
- **Escape:** Avbryt pågående operasjon og gi nye instruksjoner
- **Double-tap Escape:** Rediger forrige prompt
- **Spør Claude om å undo:** "Undo siste endring"

**Be Claude planlegge først:**
- "Planlegg hvordan du vil løse dette før du skriver kode"
- "Think hard" for mer grundig analyse

### Explore - Plan - Code workflow

**Følg alltid disse stegene:**

**1. Explore (Utforsk)**
```text
- "Les gjennom SakOversikt.tsx og forklar strukturen"
- "Finn alle steder hvor vi bruker validateSøknad"
```

**2. Plan (Planlegg)**
```text
- "Lag en plan for hvordan vi skal implementere dette"
- "Think hard about the edge cases"
```

**3. Code (Implementer)**
```text
- Skriv tester først (RED)
- Implementer løsningen (GREEN)
- Kjør regresjonstester (REFACTOR)
```

**4. Commit (Bekreft)**
```text
- Manuell testing
- Code review
- Git commit
```

### Iterasjon mot klare mål

**Bruk målbare targets:**
- **Tester:** Skriv tester som definerer ønsket oppførsel
- **Screenshots:** Vis ønsket design som målbilde
- **Spesifikasjoner:** Eksplisitte akseptansekriterier

### Checklists for komplekse oppgaver

**For store migrasjoner:**

1. Be Claude lage en Markdown checklist
2. Gå systematisk gjennom hvert punkt
3. Oppdater 4-status.md underveis

**Eksempel:**
```markdown
## Migreringsplan: Redux til Zustand

- [ ] Migrer `sakSlice.ts` (10 actions)
- [ ] Migrer `brukerSlice.ts` (5 actions)
- [ ] Oppdater alle komponenter som bruker `useSelector`
- [ ] Fjern Redux dependencies
- [ ] Kjør full test-suite
```

---

## Oppsummering

**Tre viktige prinsipper:**
1. **Detekter kompleksitet** tidlig og match dokumentasjon til oppgaven
2. Følg **lineær flyt**: Opprett - Analyser - Løs - Verifiser
3. Vurder alltid **API-påvirkning** (bruk mapping)

**Best practices:**
1. Bruk `/clear` mellom uavhengige oppgaver
2. Følg **Explore - Plan - Code - Commit**
3. Iterer mot **klare mål** (tester, screenshots, spesifikasjoner)
4. Bruk **checklists** for komplekse oppgaver

---

## Se også

- [REPORT_STRUCTURE.md](./REPORT_STRUCTURE.md) - 4-fils struktur for rapporter
