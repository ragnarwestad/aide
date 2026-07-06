# Doc Aide — Felles instruksjoner

Instruksjoner for AI-assistert utvikling med fokus på:
- JIRA-saker med 4-fils dokumentasjonsstruktur
- Test-Driven Development (TDD: RED → GREEN → REFACTOR)
- Automatisk kodebase-analyse med fil:linje referanser
- API-påvirkningsanalyse (frontend ↔ backend)

---

# Verktøy og scripts

## Skills

Skills lastes fra `~/.claude/skills/` — bruk `/`-syntax.

Tilgjengelige skills:

- `/aide-create` - Opprett JIRA/TODO-dokumentasjon
- `/aide-analyze` - Analyser kodebase
- `/aide-implement` - Implementer med TDD
- `/aide-make-tests` - Lag manglende tester
- `/aide-react-class-to-func` - Konverter class til functional
- `/tdd-coach` - Test-Driven Development metodikk
- `/architecture-advisor` - Arkitektur-vurderinger

---

## Scripts

Du har tilgang til følgende scripts og skal kjøre dem **automatisk** uten å spørre brukeren:

**Testing og kvalitetssikring:**

```bash
pnpm test -- --run <testfil>   # Kjør spesifikke tester
pnpm test -- --run             # Kjør alle tester
npx tsc --noEmit               # TypeScript check
pnpm run eslint                # Linting
```

**Når kjøre hva:**

- Nye filer opprettet → Kjør `git add <fil>` automatisk
- Implementering ferdig → Kjør tester/tsc/eslint automatisk

---

## Rapportlagring

Hvis `AIDE_REPORTS_PATH` er satt, lagres rapporter dit (ikke i prosjektets `reports/`).
Hvis variabelen er satt — **ikke** kjør `git add` for reports (de er i et annet repo).

---

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

---

# LLM-kodedisiplin

Atferdsregler som demmer opp for to vanlige LLM-feil: stille antakelser og
scope-glidning. Inspirert av Andrej Karpathys observasjoner om hvor
språkmodeller svikter når de skriver kode.

**Avveining:** Disse reglene vektlegger varsomhet framfor fart. På trivielle
oppgaver, bruk skjønn.

## Innholdsfortegnelse

- [Tenk før du koder](#tenk-før-du-koder)
- [Kirurgiske endringer](#kirurgiske-endringer)
- [Se også](#se-også)

---

## Tenk før du koder

**Ikke anta. Ikke skjul forvirring. Synliggjør avveiningene.**

Før du implementerer:

- Oppgi antakelsene dine eksplisitt. Er du usikker, spør.
- Finnes det flere tolkninger, legg dem fram — ikke velg én i stillhet.
- Finnes det en enklere tilnærming, si fra. Si imot når det er grunn til det.
- Er noe uklart, stopp. Sett ord på hva som forvirrer. Spør.

---

## Kirurgiske endringer

**Rør bare det du må. Rydd bare opp i ditt eget rot.**

Når du endrer eksisterende kode:

- Ikke «forbedre» tilstøtende kode, kommentarer eller formatering.
- Ikke refaktorer ting som ikke er ødelagt.
- Følg eksisterende stil, selv om du ville gjort det annerledes.
- Oppdager du urelatert død kode, nevn det — ikke slett det.

Når endringene dine etterlater foreldreløs kode:

- Fjern importer, variabler og funksjoner som *dine* endringer gjorde ubrukte.
- Ikke fjern død kode som allerede lå der, med mindre du blir bedt om det.

Tommelfingerregel: hver linje du endrer skal kunne spores direkte til det
brukeren ba om.

---

## Se også

To beslektede Karpathy-prinsipper har allerede egen dekning hos oss — bruk dem
framfor å duplisere:

- **Enkelhet først** (minimal kode, ingen spekulativ abstraksjon) — `/code-review`-skillen
- **Målstyrt utføring** (verifiserbare suksesskriterier, RED → GREEN → REFACTOR) — `testing.md` og `/tdd-coach`

---

# Git-regler for AI-assistert utvikling

## Innholdsfortegnelse

- [Staging av nye filer](#staging-av-nye-filer)
  - [Hovednorm](#hovednorm)
  - [Eksempel](#eksempel)
- [Filrenaming og konvertering](#filrenaming-og-konvertering)
  - [Hovednorm](#hovednorm-1)
  - [Arbeidsflyt for JS til TS konvertering](#arbeidsflyt-for-js-til-ts-konvertering)
- [Commit-meldinger](#commit-meldinger)
  - [Format](#format)
  - [Riktige eksempler](#riktige-eksempler)
- [Oppsummering](#oppsummering)

---

## Staging av nye filer

### Hovednorm
**Legg automatisk til nye filer DU har opprettet, men ALDRI andre filer!**

### ❌ FORBUDT
- `git add .` (legger til ALLE filer, inkludert genererte/uønskede)
- `git add -A` (legger til ALLE filer, inkludert genererte/uønskede)
- Legge til filer du IKKE har opprettet selv (node_modules, build-output, genererte filer, etc.)

### ✅ RIKTIG fremgangsmåte
1. Når du har opprettet NYE filer (dokumentasjon, kode, tester), kjør `git add` **automatisk** for disse
2. Bruk eksplisitte filnavn: `git add reports/<NN>-PROJ-7890-slug/beskrivelse.md` (ikke `git add .`)
3. Bare legg til filer DU selv har skrevet/opprettet
4. ALDRI legg til:
   - Genererte filer (build output, coverage reports)
   - Dependencies (node_modules, vendor)
   - IDE-filer (.idea/, *.swp)
   - Midlertidige filer

### OBS
Endrede filer (allerede tracked) trenger ikke `git add` - brukeren håndterer commit i sin IDE.

### Eksempel
```bash
# Du har opprettet 4 nye markdown-filer
git add reports/<NN>-PROJ-7890-slug/beskrivelse.md
git add reports/<NN>-PROJ-7890-slug/analyse.md
git add reports/<NN>-PROJ-7890-slug/løsning.md
git add reports/<NN>-PROJ-7890-slug/status.md

# Eller samlet:
git add reports/<NN>-PROJ-7890-slug/*.md
```

---

## Filrenaming og konvertering

### Hovednorm
**Bruk ALLTID `git mv` for å bevare git-historikk når filer omdøpes!**

### ❌ FORBUDT (mister historikk)
```bash
# Slette gammel fil og opprette ny
rm src/utils/land.js
# opprett ny src/utils/land.ts
git add src/utils/land.ts
```

### ✅ RIKTIG (bevarer historikk)
```bash
# Bruk git mv for å bevare commit-historikk
git mv src/utils/land.js src/utils/land.ts
git mv src/components/UserProfile.jsx src/components/UserProfile.tsx
```

### Hvorfor dette er viktig
- Bevarer hele commit-historikken (hvem endret hva, når, hvorfor)
- Git forstår at det er samme fil, bare med nytt navn
- `git blame` og `git log` fungerer korrekt
- Historikken vises i IDE og GitHub

### Arbeidsflyt for JS til TS konvertering
1. `git mv old.js new.ts` (først!)
2. Konverter innhold til TypeScript
3. `git add new.ts` (endringene)
4. Commit

**Denne regelen gjelder ALLTID ved JS→TS/JSX→TSX konvertering!**

---

## Commit-meldinger

### Format
**Alltid norsk, alltid i fortid (ikke imperativ).**

### ❌ ALDRI Co-Authored-By
- Legg ALDRI til `Co-Authored-By`-linjer i commit-meldinger
- Dette gjelder alle varianter (`Claude`, `Copilot`, `GPT`, etc.)

### Riktige eksempler
- "La til automatisk git add for nye filer"
- "Fjernet bruker-spesifikke paths fra settings.json"
- "Oppdaterte dokumentasjon med hook-forklaring"
- "Konverterte UserProfile.jsx til TypeScript"
- "La til enhetstester for land.ts"

### ❌ Feil (imperativ/nåtid)
- "Legg til automatisk git add for nye filer"
- "Fjern bruker-spesifikke paths"
- "Oppdater dokumentasjon"
- "Konverter til TypeScript"
- "Legg til tester"

### Struktur

```text
<Hva ble gjort i fortid>

<Valgfri: Hvorfor, kontekst, eller detaljer>
```

**Eksempel:**

```text
La til enhetstester for land.ts

Testet getLandnavn(), getLandkode(), og edge cases.
Forberedelse før JS til TS konvertering.
```

---

## Oppsummering

**Tre gullregler:**
1. ✅ Bruk `git add` med eksplisitte filnavn for NYE filer du har opprettet
2. ✅ Bruk `git mv` når filer skal omdøpes (bevarer historikk)
3. ✅ Skriv commit-meldinger på norsk i fortid

**Dette gjelder ALLTID - både i kommandoer, agents og normal interaksjon!**

---

# Testing-regler for AI-assistert utvikling

## Innholdsfortegnelse

- [Hovednorm](#hovednorm)
- [Testkommandoer](#testkommandoer)
  - [Enhetstester (Vitest)](#enhetstester-vitest)
  - [E2E-tester (Playwright)](#e2e-tester-playwright)
- [Arbeidsflyt](#arbeidsflyt)
  - [Eksempel på riktig arbeidsflyt](#eksempel-på-riktig-arbeidsflyt)
  - [Ved feilende tester](#ved-feilende-tester)
- [TDD-tilnærming](#tdd-tilnærming-test-driven-development)
- [Watch mode advarsler](#watch-mode-advarsler)

---

## Hovednorm

**ALLTID kjør tester når du oppretter eller endrer dem!**

### ❌ ALDRI
- Opprett tester uten å kjøre dem
- Endre tester uten å verifisere at de fortsatt fungerer
- Anta at tester passerer uten å sjekke
- Committe tester som feiler

### ✅ RIKTIG fremgangsmåte
1. Når du oppretter/endrer tester, **kjør dem umiddelbart**
2. **Verifiser** at alle tester passerer (grønne ✅)
3. Hvis tester feiler (røde ❌):
   - Analyser feilmeldingen
   - Fiks problemet (enten testen eller koden)
   - Kjør på nytt til alle passerer
4. **Før commit:** Kjør hele testsuiten for å sjekke for regresjoner

---

## Testkommandoer

### Enhetstester (Vitest)
```bash
# Alle tester (ALLTID bruk --run for å unngå watch mode!)
pnpm test -- --run

# Spesifikk testfil
pnpm test -- --run <filnavn>

# Med dekningsrapport
pnpm run test:coverage
```

### E2E-tester (Playwright)
```bash
# Alle e2e-tester
pnpm run test:e2e

# Spesifikk e2e-test
pnpm exec playwright test <filnavn>

# Med UI-modus (UNNGÅ - holder prosess åpen)
pnpm run test:e2e:ui
```

---

## Arbeidsflyt

### Eksempel på riktig arbeidsflyt
```text
1. Opprettet test: src/utils/land.test.ts
2. Kjører: pnpm test -- --run land.test.ts
3. ✅ Alle 5 tester passerer
4. Kjører: pnpm test -- --run (full suite for regresjonssjekk)
5. ✅ 1247 tester passerer, 0 feiler
6. Nå er det trygt å committe
```

### Ved feilende tester
```text
1. Opprettet test: src/components/UserForm.test.tsx
2. Kjører: pnpm test -- --run UserForm.test.tsx
3. ❌ 2 av 8 tester feiler
4. Analyserer feilmelding: "Expected <button> to be disabled, but was enabled"
5. Fikser koden i UserForm.tsx (disabled-logikk)
6. Kjører: pnpm test -- --run UserForm.test.tsx
7. ✅ Alle 8 tester passerer
8. Kjører: pnpm test -- --run (full suite)
9. ✅ 1255 tester passerer, 0 feiler
10. Nå er det trygt å committe
```

---

## TDD-tilnærming (Test-Driven Development)

**Red → Green → Refactor**

### 1. RED: Skriv test som feiler
Bevis problemet ved å skrive en test som demonstrerer ønsket oppførsel (men feiler fordi koden ikke er implementert ennå).

```tsx
// Eksempel: Test for ny funksjonalitet som ikke finnes ennå
test('getLandnavn should return "Norge" for code "NO"', () => {
  expect(getLandnavn('NO')).toBe('Norge');
});

// Kjør: pnpm test -- --run land.test.ts
// ❌ Feiler (beviser at funksjonaliteten mangler)
```

### 2. GREEN: Implementer til testen passerer
Skriv minimal kode for å få testen til å passere.

```typescript
// Implementer funksjonaliteten
export function getLandnavn(code: string): string {
  const land = {
    'NO': 'Norge',
    'SE': 'Sverige',
    'DK': 'Danmark',
  };
  return land[code] || 'Ukjent';
}

// Kjør: pnpm test -- --run land.test.ts
// ✅ Passerer (funksjonaliteten virker)
```

### 3. REFACTOR: Kjør alle tester
Verifiser at ingen eksisterende funksjonalitet ble ødelagt.

```bash
# Kjør hele testsuiten
pnpm test -- --run

# ✅ Alle 1255 tester passerer (ingen regresjoner)
```

---

## Watch mode advarsler

### KRITISK: Alle tester MÅ avsluttes etter kjøring

**VIKTIG:** Tester må alltid kjøres slik at prosessen avsluttes når testene er ferdige.

```bash
# ✅ RIKTIG - Tester kjører og prosessen avsluttes
pnpm test -- --run                    # Vitest - avslutter etter kjøring
pnpm test -- --run UserProfile.test.tsx  # Spesifikk test
pnpm run test:e2e                     # Playwright - avslutter automatisk

# ❌ FEIL - Watch mode (prosessen avsluttes ALDRI)
pnpm test                             # Starter i watch mode
pnpm test UserProfile.test.tsx        # Watch mode
pnpm run test:e2e:ui                  # Playwright UI-modus
```

### Hvorfor dette er kritisk

**I AI-assistert utvikling:**
- AI kan ikke interagere med watch mode (krever manuell input for å avslutte)
- Prosesser holder åpne i bakgrunnen og må drepen manuelt
- Umulig for AI å verifisere når tester er ferdig kjørt
- Kan forårsake resource-leaks

**I CI/CD pipelines:**
- Watch mode blokkerer pipeline (venter i det uendelige)
- Spiser ressurser unødvendig
- Gjør automatiserte workflows umulige

**I TDD-workflow:**
- Du må kunne kjøre tester flere ganger i syklusen
- Hver kjøring må avslutte for å gå videre til neste fase
- Watch mode ødelegger automatiseringen

### Hvordan sjekke om test-prosesser henger

**ADVARSEL:** Drep kun prosesser du selv har startet, ikke alle node-prosesser!

```bash
# Sjekk om DINE test-prosesser henger (ikke drep automatisk!)
ps aux | grep vitest
ps aux | grep playwright

# Se PID og kommando for å identifisere dine prosesser
ps aux | grep "[v]itest"    # Viser vitest-prosesser
ps aux | grep "[p]laywright" # Viser playwright-prosesser

# Drep KUN prosesser du selv har startet (bruk PID fra output over)
kill <PID>                   # Erstatt <PID> med prosess-ID

# Eksempel:
# ps aux | grep vitest
# > ragnar  12345  ... node .../vitest/...
# kill 12345
```

**VIKTIG:**
- ❌ **ALDRI** bruk `pkill -f node` (dreper alle node-prosesser!)
- ❌ **ALDRI** bruk `pkill -f vitest` uten å sjekke først
- ✅ Bruk `ps aux` for å identifisere dine prosesser
- ✅ Bruk `kill <PID>` for å drepe spesifikke prosesser

---

## Oppsummering

**Tre gullregler:**
1. ✅ Kjør tester **umiddelbart** etter opprettelse/endring
2. ✅ Verifiser at **alle tester passerer** før commit
3. ✅ Bruk **TDD** (Red → Green → Refactor) for nye features

**Denne regelen gjelder ALLTID - testing er ikke valgfritt!**

---

# Dokumentasjonsstandard

## Innholdsfortegnelse

- [Generelle regler for alle dokumenter](#generelle-regler-for-alle-dokumenter)
  - [Dokumentstruktur](#dokumentstruktur)
  - [Innholdsfortegnelse](#innholdsfortegnelse-1)
  - [Formatering](#formatering)
- [Markdown-retningslinjer](#markdown-retningslinjer)
  - [Kodeblokker](#kodeblokker)
  - [Nummererte lister](#nummererte-lister)
  - [Emojis](#emojis)
- [Best practices for AI-assistert dokumentasjon](#best-practices-for-ai-assistert-dokumentasjon)
  - [Visuell dokumentasjon](#visuell-dokumentasjon)
  - [Relaterte ressurser og URL-er](#relaterte-ressurser-og-url-er)
  - [Spesifikke instruksjoner](#spesifikke-instruksjoner)
  - [Filreferanser](#filreferanser)
- [Se også](#se-også)

---

## Generelle regler for alle dokumenter

Disse reglene gjelder for ALLE markdown-dokumenter i prosjektet.

### Dokumentstruktur

Alle dokumenter skal følge denne strukturen:

```markdown
# Dokumenttittel

## Innholdsfortegnelse

- [Seksjon 1](#seksjon-1)
  - [Underseksjon 1.1](#underseksjon-11)
- [Seksjon 2](#seksjon-2)

---

## Seksjon 1

Innhold...
```

### Innholdsfortegnelse

**Krav:**
- Alle dokumenter over 50 linjer SKAL ha innholdsfortegnelse
- Bruk 2 nivåer (hovedseksjoner og underseksjoner)
- Plasser etter formål-setningen og før første innholdsseksjon
- Overskriften skal være `## Innholdsfortegnelse` (uten emoji)

**Format:**
```markdown
## Innholdsfortegnelse

- [Hovedseksjon](#hovedseksjon)
  - [Underseksjon](#underseksjon)
```

### Formatering

**Titler og overskrifter:**
- Dokumenttittel: `# Tittel` (kun én per dokument)
- Hovedseksjoner: `## Seksjon`
- Underseksjoner: `### Underseksjon`
- Ingen emojis i overskrifter (forårsaker problemer med anchor-lenker)

**Separatorer:**
- Bruk `---` mellom logiske seksjoner
- Alltid `---` etter innholdsfortegnelsen

---

## Markdown-retningslinjer

### Kodeblokker

**Alltid spesifiser språk ved START:**
- `tsx` for kode med JSX (React: `<Component />`)
- `typescript` for TypeScript uten JSX
- `bash` for shell-kommandoer
- `markdown` for markdown-eksempler
- `text` for generell output

**Hvorfor:** IDEer parser kodeblokker og gir warnings hvis syntaks ikke matcher.

**KRITISK: Avslutning av kodeblokker:**

Kodeblokker avsluttes ALLTID med bare tre backticks - ALDRI med språk-specifier:

````markdown
```bash
echo "Hello"
```
````

**FEIL (vanlig AI-feil):**

````markdown
```bash
echo "Hello"
```text
````

**Hvorfor dette er viktig:**
- ` ```text` som avslutning bryter markdown-parsing
- Pandoc og andre konverterere tolker det som ny kodeblokk
- HTML-generering feiler med ødelagte kodeblokker
- Anchor-lenker kan bli ødelagt

**Før/Etter kodeeksempler:**

Del alltid "Før" og "Etter" i SEPARATE kodeblokker:

````markdown
**Før:**
```tsx
const [value, setValue] = useState();
```

**Etter:**
```tsx
const value = useSelector(state => state.value);
```
````

**Hvorfor:** Unngår redeclaration-feil (samme variabelnavn i én kodeblokk).

### Nummererte lister

**Start alltid på 1 etter en header/seksjonsskift:**

```markdown
#### Filer å endre:

1. fil1.tsx
2. fil2.tsx

#### Filer å teste:

1. test1.tsx   (RIKTIG - starter på 1)
2. test2.tsx
```

**Hvorfor:** Markdown-lintere forventer at nye lister starter på 1.

### Emojis

**IKKE bruk emojis i section headings (## overskrifter):**

```markdown
## 📋 Innholdsfortegnelse   (FEIL - emoji i heading)
## Innholdsfortegnelse      (RIKTIG)
```

**Hvorfor:** Markdown-prosessorer stripper emojis fra heading IDs, som forårsaker MD051-feil (anchor link mismatch).

**OK å bruke emojis i:**
- Innhold og brødtekst
- Lister og tabeller
- Metadata-felt

**Se også:** [MARKDOWN_LINTING.md](./MARKDOWN_LINTING.md) for detaljerte linting-regler.

---

## Best practices for AI-assistert dokumentasjon

### Visuell dokumentasjon

**Bruk screenshots og design mocks når det er relevant:**
- Inkluder screenshots av UI-problemer eller feil
- Legg ved design mocks for å vise ønsket sluttresultat
- Lag assets-mappe: `assets/` i dokumentmappen
- Referer til bilder i markdown: `![Beskrivelse](./assets/screenshot.png)`

**Hvorfor:** Moderne AI-assistenter er multimodale og kan iterere visuelt mot et målbilde.

**Eksempel:**
```markdown
## Problem

Datepicker viser feil format i Safari:

![Safari bug](./assets/safari-datepicker-bug.png)

Ønsket resultat:

![Design mock](./assets/datepicker-design.png)
```

### Relaterte ressurser og URL-er

**Inkluder lenker til eksterne ressurser:**
- JIRA-saker: `https://jira.example.com/browse/PROJ-XXXX`
- Confluence-dokumentasjon
- Design-dokumenter (Figma, Sketch)
- API-dokumentasjon (Swagger, OpenAPI)

**Hvorfor:** URL-er gir AI-assistenter tilgang til oppdatert dokumentasjon og kontekst.

### Spesifikke instruksjoner

**Vær eksplisitt og detaljert i beskrivelser:**

**Vagt eksempel:**
```markdown
## Problem
Legg til tester for foo.tsx
```

**Spesifikt eksempel:**
```markdown
## Problem
Skriv enhetstester for `validateSøknadSkjema()` i foo.tsx:156.
Test følgende edge cases:
- Ugyldig personnummer (11 siffer, men feil kontrollsiffer)
- Manglende påkrevde felt (navn, adresse)
- Dato i fremtiden for fødselsdato

Unngå mocks for validering - bruk reelle test-data.
```

**Hvorfor:** Spesifikke instruksjoner gir betydelig høyere suksessrate.

### Filreferanser

**Bruk konkrete filstier:**
- Nevn eksakte filer: `src/components/Saksoversikt.tsx`
- Bruk linjenummer: `Saksoversikt.tsx:123-145`

**Hvorfor:** Hjelper AI-assistenter å lokalisere riktige ressurser uten å søke.

---

## Se også

- [REPORT_STRUCTURE.md](./REPORT_STRUCTURE.md) - 4-fils struktur for JIRA/TODO rapporter
- [MARKDOWN_LINTING.md](./MARKDOWN_LINTING.md) - Markdown linting-regler

---

# Markdown Linting

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Bruk](#bruk)
- [Konfigurasjon](#konfigurasjon)
- [Ansvar](#ansvar)
- [Vanlige feil og løsninger](#vanlige-feil-og-løsninger)
  - [MD029: List numbering](#md029-list-numbering)
  - [MD040: Missing code block language](#md040-missing-code-block-language)
  - [MD051: Broken anchor link](#md051-broken-anchor-link)
  - [Vanlig AI-feil: Kodeblokk-avslutning med språk](#vanlig-ai-feil-kodeblokk-avslutning-med-språk)

---

## Oversikt

Dette workspace bruker `markdownlint-cli2` via `npx` for å fange opp markdown-feil før de committes.

**Fokusområder:**
1. **List numbering (MD029)** - Numbered lists must restart at 1 after headers
2. **Anchor links (MD051)** - TOC links must match actual heading anchors
3. **Code block language (MD040)** - All code blocks must specify language (tsx, typescript, bash, etc.)

## Bruk

### Sjekk alle markdown-filer

```bash
npx markdownlint-cli2 '**/*.md'
```

### Automatisk fikse det som kan fikses

```bash
npx markdownlint-cli2 --fix '**/*.md'
```

## Konfigurasjon

Se `.markdownlint-cli2.jsonc` for reglene.

**Viktig:** Konfigurasjonen er minimal og fokuserer KUN på de kritiske issuene vi har hatt problemer med.

## Ansvar

**ALLE AI-implementasjoner (Claude Code, Cursor, Junie, Codex, etc.):**
- Må ALLTID kjøre linting på markdown-filer etter skriving/endring/flytting
- Må fikse alle MD029, MD040 og MD051 feil før oppgaven er ferdig
- Kommando: `npx markdownlint-cli2 <fil.md>` eller `npx markdownlint-cli2 '**/*.md'`

**Manuell sjekk (valgfritt):** Du kan kjøre linting for å dobbeltsjekke.

## Vanlige feil og løsninger

### MD029: List numbering

**Feil:**
```markdown
### My Header

3. First item
4. Second item
```

**Løsning:**
```markdown
### My Header

1. First item
2. Second item
```

### MD040: Missing code block language

**Feil:**
```markdown
\```
const foo = 'bar';
\```
```

**Løsning:**
```markdown
\```typescript
const foo = 'bar';
\```
```

**Viktig:** Bruk `tsx` for React/JSX code, ikke `typescript`.

### MD051: Broken anchor link

**Feil:**
```markdown
- [My Section](#my-section)

## 1. My Section
```

**Løsning:**
```markdown
- [My Section](#1-my-section)

## 1. My Section
```

Eller oppdater HTML anchor:
```markdown
<a id="my-section"></a>
## 1. My Section
```
til:
```markdown
<a id="1-my-section"></a>
## 1. My Section
```

### Vanlig AI-feil: Kodeblokk-avslutning med språk

**Feil (ikke fanget av linter, men bryter HTML-generering):**

````markdown
```bash
echo "Hello"
```text
````

**Løsning:**

````markdown
```bash
echo "Hello"
```
````

**Hvorfor dette skjer:**
- AI-assistenter (Claude, Copilot, etc.) skriver noen ganger ` ```text` som avslutning
- Dette er IKKE gyldig markdown - kodeblokker avsluttes ALLTID med bare ` ``` `
- Pandoc og andre konverterere tolker ` ```text` som START på ny kodeblokk
- Resultatet er ødelagt HTML med feil kodeblokker og brutte anchor-lenker

**Preventiv fix:**
- `aide-generate-html` scriptet retter dette automatisk
- Men kilden bør fikses - se [DOCUMENTATION_STANDARD.md](./DOCUMENTATION_STANDARD.md#kodeblokker)

---

---
paths:
  - "**/aide-reports/**"
---

# Rapport-struktur for JIRA og TODO

## Innholdsfortegnelse

- [Oversikt](#oversikt)
- [Filstruktur](#filstruktur)
  - [1-description](#1-description)
  - [2-analysis](#2-analysis)
  - [3-solution](#3-solution)
  - [4-status](#4-status)
- [Separasjon av innhold](#separasjon-av-innhold)
- [Forskjeller JIRA vs TODO](#forskjeller-jira-vs-todo)
- [Templates](#templates)
- [Se også](#se-også)

---

## Oversikt

4 standardiserte filer per sak/plan:

```text
reports/<NN>-slug/          # flat struktur, samme for JIRA og TODO
├── 1-description.md        # (JIRA: PROJ-nøkkel inngår i sluggen)
├── 2-analysis.md
├── 3-solution.md
└── 4-status.md
```

**Roller:**
1. **1-description.md** - Hovedinngang: Problem, omfang, akseptansekriterier
2. **2-analysis.md** - Detaljert analyse: Funn, kompleksitet, risiko
3. **3-solution.md** - Implementasjonsplan med TDD-tilnærming
4. **4-status.md** - Levende dokument: Fremdrift og status

---

## Filstruktur

### 1-description

**Formål:** Gi oversikt over saken, omfanget og akseptansekriteriene.

**Struktur:**
```markdown
# [Tittel]

## Innholdsfortegnelse

- Metadata
- Beskrivelse
- Problem
- Omfang
- Akseptansekriterier

---

## Metadata

**JIRA:** Tabell med type, status, prioritet, reporter, assignee
**TODO:** Nummer, opprettet dato, forventet varighet

---

## Beskrivelse

**Dette feltet kan redigeres manuelt for å legge til:**
- Ekstra kontekst eller presiseringer
- Spesifikke tekniske krav
- Avklaringer fra møter/diskusjoner

---

## Problem

[Beskrivelse kopiert fra JIRA eller skrevet av utvikler]

## Omfang

**Berørte filer/komponenter:** [antall fra analyse]
**Estimert arbeidsinnsats:** [tid basert på funn]

## Akseptansekriterier

[Kriterier for når saken/planen er ferdig]

```

**Nøkkelpunkter:**
- Innholdsfortegnelse for rask navigasjon
- Metadata-tabell (JIRA/TODO-spesifikk)
- Beskrivelse-seksjonen er redigerbar for manuell tilleggsinformasjon
- Problem-seksjonen kopieres direkte (ikke skriv om)
- Ingen kodeeksempler (de hører hjemme i 3-solution.md)

---

### 2-analysis

**Formål:** Detaljert teknisk analyse av problemet.

**Struktur:**
```markdown
# [Tittel] - Analyse

## Innholdsfortegnelse

- Omfang
- Kompleksitet
- Funn
- Risikoanalyse

---

## Omfang

**Antall berørte filer/komponenter:** [tall]
**Sist analysert**: [dato]

**Berørte filer/komponenter:**
1. `fil/path.tsx:123-145` - [beskrivelse]
2. `fil/path2.tsx:67` - [beskrivelse]

## Kompleksitet

### [Høy/Middels/Lav kompleksitet]

**Estimat:**
- **Manuell utvikling:** [tid]
- **AI-assistert utvikling:** [tid]

## Funn

### Kodebase-analyse

[Detaljerte funn]

### Berørte komponenter

[Detaljert beskrivelse per fil med konkrete linjenummer]

### Test-dekning

**Eksisterende tester:** [liste]
**Manglende tester:** [gaps]

## Risikoanalyse

### [Høy/Middels/Lav risiko]

**[Risiko 1]**
- **Konsekvens:** [beskrivelse]
- **Sannsynlighet:** [Høy/Middels/Lav]
- **Mitigering:** [hvordan redusere]
```

**Nøkkelpunkter:**
- Fokuser på ANALYSE (ikke løsning)
- Inkluder konkrete filer med linjenummer
- Estimater for både manuell og AI-assistert utvikling
- Ingen implementasjonsplan eller løsningsforslag

---

### 3-solution

**Formål:** Implementeringsplan med TDD-tilnærming.

**Struktur:**

````markdown
# [Tittel] - Løsning

## Innholdsfortegnelse

- Tilnærminger
- Anbefalt løsning
- Implementeringsplan
- Testing
- Referanser

---

## Tilnærminger

### Tilnærming 1: [Navn] (anbefalt)

**Fordeler:** [liste]
**Ulemper:** [liste]
**Estimat:** [tid]

---

## Anbefalt løsning

### Før/Etter eksempler

**Før:**
```tsx
// fil/path.tsx:123
[gammel kode]
```

**Etter:**
```tsx
// fil/path.tsx:123
[ny kode]
```

---

## Implementeringsplan

### TDD-tilnærming (Red-Green-Refactor)

### Fase 1: Skriv tester (RED)
- [ ] Oppgave 1
- [ ] Oppgave 2

### Fase 2: Implementer løsningen (GREEN)
- [ ] Oppgave 1
- [ ] Oppgave 2

### Fase 3: Verifiser (REFACTOR)
- [ ] Kjør full test-suite
- [ ] Sjekk for regresjoner

---

## Testing

### Unit tests
[Testningstrategi]

### Manual testing
[Hva må testes manuelt]

---

## Referanser

- 1-description.md - Problembeskrivelse
- 2-analysis.md - Analyse og funn
````

**Nøkkelpunkter:**
- Tilnærminger med fordeler/ulemper
- Før/Etter i SEPARATE kodeblokker (unngår redeclaration-feil)
- TDD-tilnærming med RED-GREEN-REFACTOR faser

---

### 4-status

**Formål:** Levende dokument som oppdateres underveis.

**Struktur:**
```markdown
# [Tittel] - Status

**Total fremgang:** X% (Y av Z fullført)
**Estimat:** [tid]

## Innholdsfortegnelse

- Fase 1: Navn
- Fase 2: Navn
- Notasjon

---

## Fase 1: [Navn]

| Oppgave | Status | Notater |
|---------|--------|---------|
| Oppgave 1 | ⬜ | [notater] |
| Oppgave 2 | 🔄 | [notater] |
| Oppgave 3 | ✅ | [notater] |

---

## Notasjon

| Symbol | Betydning |
|--------|-----------|
| ⬜ | Ikke startet |
| 🔄 | Under arbeid |
| ✅ | Fullført |
| ❌ | Blokkert |
| ⚠️ | Venter |
```

**Nøkkelpunkter:**
- Total fremgang øverst
- Organisert i faser (matcher 3-solution.md)
- Tabellformat for oversiktlighet
- Oppdateres kontinuerlig

---

## Separasjon av innhold

| Innhold                    | Plassering        |
|----------------------------|-------------------|
| Problembeskrivelse         | 1-description.md  |
| Metadata                   | 1-description.md  |
| Akseptansekriterier        | 1-description.md  |
| Kartlegging/funn           | 2-analysis.md      |
| Kompleksitetsanalyse       | 2-analysis.md      |
| Risikoanalyse              | 2-analysis.md      |
| Tilnærminger               | 3-solution.md      |
| Før/etter eksempler        | 3-solution.md      |
| Implementeringsplan        | 3-solution.md      |
| Testing-strategi           | 3-solution.md      |
| Fremdrift                  | 4-status.md       |

---

## Forskjeller JIRA vs TODO

JIRA-saker og TODO-planer har **identisk struktur**, men forskjeller i innhold:

| Aspekt          | JIRA-saker                    | TODO-planer           |
|-----------------|-------------------------------|-----------------------|
| **Lokasjon**    | `reports/<NN>-PROJ-XXXX-slug/` | `reports/<NN>-slug/`  |
| **Kilde**       | JIRA API (ekstern)            | Manuelt opprettet     |
| **Beskrivelse** | Kopieres fra JIRA             | Skrives av utvikler   |
| **Metadata**    | JIRA-felt (type, status, etc.)| Nummer, dato          |

**Felles:**
- 4 filer: 1-description.md, 2-analysis.md, 3-solution.md, 4-status.md
- Samme struktur og formattering
- Samme notasjon (⬜ 🔄 ✅ ❌ ⚠️)
- Samme TDD-tilnærming i 3-solution.md

---

## Templates

AI-verktøy oppretter dokumentasjon direkte basert på strukturen beskrevet i dette dokumentet.

Kommandoen `/aide-create` oppretter 4-fils strukturen med riktige plassholdere.
Kommandoen `/aide-analyze` fyller inn analyse, løsning og status.

---

## Se også

- [DOCUMENTATION_STANDARD.md](./DOCUMENTATION_STANDARD.md) - Generelle dokumentasjonsregler
- [MARKDOWN_LINTING.md](./MARKDOWN_LINTING.md) - Markdown linting-regler

---

# Kommunikasjons-regler

Regler for hvordan AI-assistenten presenterer tekst i samtalen til brukeren.

## Innholdsfortegnelse

- [Forslag til tekst brukeren skal kopiere ut](#forslag-til-tekst-brukeren-skal-kopiere-ut)

---

## Forslag til tekst brukeren skal kopiere ut

**Ikke bruk markdown-blockquote (`> ` foran hver linje)** når du foreslår tekst brukeren skal kopiere og lime inn et annet sted (Slack-meldinger, PR-kommentarer, commit-meldinger, e-poster, etc.).

**Hvorfor:** Blockquote rendres som en vertikal strek i venstre marg i terminalen, og `>`-tegnene blir med ved kopiering. Det gjør teksten ubrukelig uten manuell opprydning.

**Hvordan:**

- Skill mellom tekst som er *ditt svar* (kan bruke blockquote/headere fritt) og tekst som er *forslag til ekstern bruk* (ren tekst, ikke prefiks hver linje med `>`).
- For å avgrense forslagsteksten visuelt, bruk heller `---` over og under, eller en kort innledning som "Forslag:" på linja før.
- Markdown for kursiv/fet/lister inni forslaget er ok — det er bare blockquote-prefikset som er problemet.

**Eksempel:**

Feil:

```text
Forslag til Slack-melding:

> Takk for gjennomgangen.
> Vi har ryddet i koden nå.
```

Riktig:

```text
Forslag til Slack-melding:

---

Takk for gjennomgangen.
Vi har ryddet i koden nå.

---
```

Denne regelen gjelder ALLE prosjekter og sesjoner.
