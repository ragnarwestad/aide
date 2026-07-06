---
name: task-workflow-assistant
description: >-
  Strukturert analyse og planlegging av JIRA-saker og TODO-planer.
  Use when: skal analysere en JIRA-sak, skal lage en TODO-plan, skal identifisere påvirkede filer.
  Do NOT use for: ren kodeimplementering, TDD-syklus, kode-review
effort: high
---

# Task Workflow Assistant

## Når å bruke denne skill

- Du skal analysere en JIRA-sak
- Du skal lage en TODO-plan
- Du skal identifisere påvirkede filer
- Du skal estimere kompleksitet

---

## 4-fils struktur

### 1. beskrivelse.md

**Innhold:**
- JIRA-data (tittel, beskrivelse, akseptansekriterier)
- Omfang (hva skal gjøres, hva skal IKKE gjøres)
- Forutsetninger og avhengigheter

**Struktur:** Følg `rapport-strukturen` § 1-beskrivelse

### 2. analyse.md

**Innhold:**
- Påvirkede filer (med **fil:linje** referanser)
- Kompleksitet (enkel/middels/kompleks)
- Risikoanalyse
- API-påvirkning (frontend ↔ backend)

**Struktur:** Følg `rapport-strukturen` § 2-analyse

**Eksempel:**
```markdown
## Påvirkede filer

### Frontend
- `src/components/UserProfile.tsx:45` - Må oppdatere form-validering
- `src/api/userApi.ts:12` - Må legge til nytt endpoint-kall

### Backend
- `com/example/api/UserController.kt:78` - Må oppdatere DTO
- `com/example/domain/User.kt:23` - Må legge til nytt felt
```

### 3. løsning.md

**Innhold:**
- TDD-basert implementeringsplan
- Steg 0: Skriv tester (RED phase)
- Steg 1-N: Implementering (GREEN phase)
- Testing-strategi (REFACTOR phase)
- Hver steg: konkret, testbart, estimert tid

**Struktur:** Følg `rapport-strukturen` § 3-løsning

**Eksempel:**
```markdown
## Implementeringsplan

### Steg 0: Skriv tester (RED phase)
- [ ] `UserProfile.test.tsx` - Test ny validering (30 min)
- [ ] `UserController.test.kt` - Test nytt endpoint (30 min)

### Steg 1: Implementer backend (GREEN phase)
- [ ] Legg til felt i `User.kt` (15 min)
- [ ] Oppdater `UserController.kt` (30 min)
- [ ] Kjør tester - verifiser at de passerer (10 min)

### Steg 2: Implementer frontend (GREEN phase)
- [ ] Oppdater `UserProfile.tsx` (45 min)
- [ ] Oppdater `userApi.ts` (15 min)
- [ ] Kjør tester - verifiser at de passerer (10 min)

### Steg 3: Refaktorering og kvalitetssikring (REFACTOR phase)
- [ ] TypeScript check: `npx tsc --noEmit` (5 min)
- [ ] ESLint: `pnpm run eslint` (5 min)
- [ ] Alle tester: `pnpm test -- --run` (10 min)
```

### 4. status.md

**Innhold:**
- Fremdriftssporing
- Utfordringer og løsninger
- Tester (status, coverage)
- Deployment-status

**Struktur:** Følg `rapport-strukturen` § 4-status

---

## Analyser impact

### Frontend vs Backend

Bruk API mapping til å identifisere:
- Er dette en frontend-bug (parsing/visning)?
- Er dette en backend-bug (data/logikk)?
- Påvirker det begge lag?

### API-påvirkning

```markdown
## API-påvirkning

### Endret endpoint
- `GET /api/user/{id}` → Response-format endret
- Påvirkede frontend-filer:
  - `src/api/userApi.ts:12`
  - `src/components/UserProfile.tsx:45`
```

### Kompleksitet

**Enkel:**
- 1-2 filer påvirket
- Ingen API-endringer
- < 2 timer estimert arbeid

**Middels:**
- 3-5 filer påvirket
- Mindre API-endringer
- 2-8 timer estimert arbeid

**Kompleks:**
- > 5 filer påvirket
- Store API-endringer eller nye endpoints
- > 8 timer estimert arbeid
- Krever dypere resonnering (Extended Thinking)

---

## Referanser

- `workflows-reglene` - Komplett workflow-dokumentasjon
- `dokumentasjonsstandarden` - 4-fils struktur-standard
- API mapping guide