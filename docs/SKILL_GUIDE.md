# Guide: Skrive gode skills

Intern guide. Kombinerer Anthropics offisielle anbefalinger med
praktiske erfaringer fra store skill-samlinger (30+ skills i
produksjonsbruk).

## Innholdsfortegnelse

- [Offisielle kilder](#offisielle-kilder)
- [Filstruktur og progressive disclosure](#filstruktur-og-progressive-disclosure)
- [Description-feltet](#description-feltet)
- [Skill-typer](#skill-typer)
- [Hva skiller gode skills fra middelmådige](#hva-skiller-gode-skills-fra-middelmådige)
- [Anti-patterns er viktigst](#anti-patterns-er-viktigst)
- [Debugging-queries](#debugging-queries)
- [Størrelse og dybde](#størrelse-og-dybde)
- [Sjekkliste for nye og eksisterende skills](#sjekkliste-for-nye-og-eksisterende-skills)
- [Eksempler å studere](#eksempler-å-studere)

---

## Offisielle kilder

Les disse først — vi gjentar ikke innholdet her:

- [The Complete Guide to Building Skills for Claude](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf) — Anthropics fullstendige guide (28 sider)
- [How to Create Custom Skills](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills) — tekniske krav og best practices
- [skill-creator plugin](https://claude.com/plugins/skill-creator) — interaktivt verktøy for å lage, teste og iterere på skills
- [agentskills.io](https://agentskills.io) — åpen standard for portable skills på tvers av AI-verktøy

---

## Filstruktur og progressive disclosure

Anthropic beskriver tre nivåer av innlasting:

| Nivå | Hva | Når det lastes |
|------|-----|----------------|
| 1. Frontmatter | `name` + `description` | Alltid (i system prompt) |
| 2. SKILL.md body | Kjerneinstruksjoner | Når Claude tror skillen er relevant |
| 3. `references/` | Tung dokumentasjon | Når Claude trenger detaljer |

**Konsekvens:** Hold SKILL.md fokusert på kjerneinstruksjoner. Flytt tung
dokumentasjon (SQL-queries, enum-referanser, API-mapping) til `references/`.

```text
my-skill/
├── SKILL.md              # Kjerneinstruksjoner (maks ~200 linjer)
└── references/            # Detaljdokumentasjon (lastes on demand)
    ├── debugging.md
    ├── common-issues.md
    └── enum-reference.md
```

**Gode eksempler på dette:** e2e-test-skills med referansefiler for
debugging-queries og enum-referanser i `references/`.

**Våre skills som bør refaktoreres:** aide-create, aide-analyze, aide-implement
har alt i SKILL.md (150-200 linjer). Detaljerte prompts bør flyttes til
`references/`.

---

## Description-feltet

Anthropic kaller dette "the most important part". Formelen:

```text
[Hva skillen gjør] + [Når den skal brukes] + [Nøkkelfunksjoner]
```

Maks 1024 tegn. Ingen XML-tags (`<` eller `>`). Inkluder konkrete
trigger-fraser brukere faktisk skriver.

**God:**

```yaml
description: >-
  Genererer detaljerte manuelle testbeskrivelser for UI.
  Use when: skal skrive manuelle teststeg, skal beskrive hvordan
  opprette en sak i UI, skal lage testscenarier med spesifikke
  dropdown-verdier.
  Do NOT use for: automatiserte tester (Vitest/Playwright).
```

**Svak (typisk mønster):**

```yaml
description: >-
  React/TypeScript utvikling for prosjektet.
```

Mangler: trigger-fraser, "Do NOT use for", nøkkelfunksjoner.

---

## Skill-typer

Vi har to hovedtyper med ulik struktur:

### Workflow-skills (aide-create, tdd-coach)

Stegvise oppskrifter som Claude følger. Strukturen er:

```markdown
# Skill-tittel

Kort intro.

## Når å bruke

Eksplisitte triggere.

## Workflow

### Steg 1: [Navn]
Hva Claude gjør, med konkrete kommandoer.

### Steg 2: [Navn]
...

## Feilhåndtering

Vanlige problemer og løsninger.
```

### Domeneskills (saksflyt, lovvalg, vedtak, database)

Ekspertkunnskap om et spesifikt område. Strukturen er:

```markdown
# Skill-tittel

Kort intro (2-3 setninger).

## Quick Reference

Tabell med nøkkelkomponenter, tjenester eller operasjoner.

## Domenemodell

Entiteter og relasjoner.

## Nøkkeltjenester

Hva de gjør, hvor de bor (fil:linje), hvordan de henger sammen.

## Vanlige feil

| Symptom | Årsak | Løsning |

## Fallgruver

Anti-patterns med forklaring på HVORFOR.

## Debugging

SQL-queries eller undersøkelsessteg.

## Relaterte skills
```

---

## Hva skiller gode skills fra middelmådige

**Gode skills svarer på "hva gjør jeg når det feiler".**

En skill som bare forklarer happy-path er en referanse. En skill som
dokumenterer hva som går galt, hvorfor, og hvordan du finner ut av det
er et verktøy.

| Middelmådig | God |
|-------------|-----|
| Forklarer domenemodellen | + hva som skjer når relasjoner mangler |
| Lister tjenester | + vanlige feilsituasjoner per tjeneste |
| Viser korrekt bruk | + hva du IKKE skal gjøre og hvorfor |
| Generelle advarsler | Daterte, evidensbaserte påstander |

---

## Anti-patterns er viktigst

Dokumenter eksplisitt hva som **ikke** fungerer og hvorfor.
Mønsteret er: **påstand → forklaring → alternativ**.

**Eksempel (fra en e2e-test-skill):**

```markdown
## Hva du IKKE skal gjøre

**ALDRI bruk page.reload() som fallback ved step-transition-feil.**

Hvorfor: Step wizard bruker client-side state. Reload sender deg
tilbake til steg 1. Testen ser ut til å fortsette, men du tester
feil steg — og feilen maskeres.

Bruk i stedet: waitForContent-parameter med element fra NESTE steg.
```

**Eksempel (fra en backend-skill):**

```markdown
## Fallgruver

**AFTER_COMMIT betyr IKKE at du har ferske objekter.**

Entiteter hentet FØR commit er fortsatt tilgjengelige, men kan ha
stale state. Hent på nytt fra repository inne i AFTER_COMMIT-handleren.
```

**Dater påstandene dine.** "Bekreftet mars 2026, ~60% flake rate på
Yrkessituasjon-steget" er mye mer nyttig enn "dette kan noen ganger feile".
Daterte påstander lar fremtidige lesere vurdere om de fortsatt er relevante.

---

## Debugging-queries

Backend-skills bør ha ferdige SQL-queries. Frontend-skills bør ha
tilsvarende (console-kommandoer, nettverks-inspeksjon, state-debugging).

Legg queries i `references/debugging.md` hvis det er mange.

**Eksempel (fra en backend-skill):**

```sql
-- Finn alle prosessinstanser for en behandling
SELECT pi.ID, pi.PROSESS_TYPE, pi.STATUS, pi.OPPRETTET_TID
FROM PROSESSINSTANS pi
WHERE pi.BEHANDLING_ID = :behandlingId
ORDER BY pi.OPPRETTET_TID DESC;

-- Finn stuck prosesser (eldre enn 1 time, fortsatt KJØRER)
SELECT pi.ID, pi.PROSESS_TYPE, b.FAGSAK_ID
FROM PROSESSINSTANS pi
JOIN BEHANDLING b ON b.ID = pi.BEHANDLING_ID
WHERE pi.STATUS = 'KJOERER'
AND pi.OPPRETTET_TID < SYSDATE - INTERVAL '1' HOUR;
```

---

## Størrelse og dybde

| Linjer i SKILL.md | Vurdering |
|--------------------|-----------|
| < 80 | For tynn — bruk som router-skill eller utvid |
| 80-200 | Bra for workflow-skills og fokuserte domeneskills |
| 200-350 | Bra for brede domeneskills — vurder references/ |
| 350+ | Flytt detaljer til references/, hold SKILL.md under 200 |

**Hyperspecialisering fungerer.** En skill som `pom-from-recording`
(480 linjer totalt, fordelt på SKILL.md + references/) løser ett vanskelig
problem grundig — og var den mest verdifulle skillen i sitt prosjekt.

Én dyp skill > fire grunne skills.

---

## Sjekkliste for nye og eksisterende skills

### Frontmatter

- [ ] `name` i kebab-case, matcher mappenavn
- [ ] `description` følger formelen: [Hva] + [Når] + [Nøkkelfunksjoner]
- [ ] `description` inkluderer trigger-fraser brukere faktisk skriver
- [ ] `description` har "Do NOT use for" der det er relevant
- [ ] `description` under 1024 tegn, ingen XML-tags

### Struktur

- [ ] SKILL.md fokusert på kjerneinstruksjoner (under ~200 linjer)
- [ ] Tung dokumentasjon i `references/` (ikke alt i SKILL.md)
- [ ] Instruksjoner er spesifikke og handlingsbare, ikke vage

### Innholdskvalitet

- [ ] Dokumenterer vanlige feil (symptom → årsak → løsning)
- [ ] Har anti-patterns/fallgruver med forklaring på *hvorfor*
- [ ] Har debugging-steg eller queries
- [ ] Inkluderer eksempler (input → output eller før → etter)
- [ ] Kryssreferanser til relaterte skills
- [ ] Daterer evidensbaserte påstander

---

## Eksempler å studere

### Workflow-skills (doc-aide/core/skills/)

| Skill | Hvorfor den er god |
|-------|--------------------|
| `tdd-coach` | Klar formel (RED-GREEN-REFACTOR), grunnregler, testkommandoer |

### Kjennetegn ved sterke skills (fra tidligere skill-samlinger)

| Kjennetegn | Eksempel |
|------------|----------|
| Anti-patterns med tidslinjer | Race conditions dokumentert med hendelsesforløp |
| Evidensbasert feilsøking | Daterte påstander med flake rates |
| Beslutningstrær og sjekklister | 13-punkts sjekkliste før ferdigstilling |
| Tunge detaljer i references/ | Database-queries og enum-referanser on demand |
