# Flytte melosys-aide installasjon til MELOSYS_PROJECTS_PATH - Status

**Total fremgang:** 0% (0 av 4 faser fullfort)
**Estimat:** 2-4 timer (tilnaerming 1)

## Innholdsfortegnelse

- [Sporingsinfo](#sporingsinfo)
- [Fase 1: Forbered infrastruktur](#fase-1-forbered-infrastruktur)
- [Fase 2: Tilpass konfigurasjon](#fase-2-tilpass-konfigurasjon)
- [Fase 3: Verifiser](#fase-3-verifiser)
- [Fase 4: Rydd opp](#fase-4-rydd-opp)
- [Notasjon](#notasjon)
- [Relaterte dokumenter](#relaterte-dokumenter)

---

## Sporingsinfo

| Felt | Verdi |
|------|-------|
| **Oppgave** | `70-flytte-aide-til-projects-path/` |
| **Sist oppdatert** | 2026-02-20 |

---

## Fase 1: Forbered infrastruktur

| Oppgave | Status | Notater |
|---------|--------|---------|
| `git init` i ~/develop/nav/ | ⬜ | Workaround for oppstartsheng |
| Opprett .gitignore | ⬜ | Ignorer alt unntatt Claude-filer |
| Kjor install.sh mot nav/ | ⬜ | Eksisterende script |

---

## Fase 2: Tilpass konfigurasjon

| Oppgave | Status | Notater |
|---------|--------|---------|
| Oppdater CLAUDE.md sti-referanser | ⬜ | Legg til repo-prefiks |
| Oppdater system-paths.md | ⬜ | Legg til repo-prefiks i tabeller |
| Verifiser settings.json | ⬜ | Allerede `~/develop/nav/**` |

---

## Fase 3: Verifiser

| Oppgave | Status | Notater |
|---------|--------|---------|
| Start Claude fra nav-niva | ⬜ | Warp terminal |
| Verifiser skills lastes | ⬜ | |
| Verifiser rules lastes | ⬜ | |
| Test git -C operasjoner | ⬜ | |
| Test /aide-* kommandoer | ⬜ | |
| Test tverrfaglig oppgave | ⬜ | |

---

## Fase 4: Rydd opp

| Oppgave | Status | Notater |
|---------|--------|---------|
| Fjern .claude/ fra melosys-web | ⬜ | Valgfritt |
| Fjern .claude/ fra melosys-api | ⬜ | Valgfritt |
| Oppdater INSTALL.md | ⬜ | Dokumenter foreldre-mappe oppsett |

---

## Notasjon

| Symbol | Betydning |
|--------|-----------|
| ⬜ | Ikke startet |
| 🔄 | Under arbeid |
| ✅ | Fullfort |
| ❌ | Blokkert |
| ⚠️ | Venter |

---

## Relaterte dokumenter

- [1-beskrivelse.md](1-beskrivelse.md) - Problembeskrivelse
- [2-analyse.md](2-analyse.md) - Analyse og funn
- [3-losning.md](3-løsning.md) - Losningsforslag og plan

**Archived:** 2026-08-13
