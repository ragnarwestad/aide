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
