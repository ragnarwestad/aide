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
