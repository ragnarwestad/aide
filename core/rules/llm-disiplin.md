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
