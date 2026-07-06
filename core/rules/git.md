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
