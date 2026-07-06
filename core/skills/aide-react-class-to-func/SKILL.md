---
name: aide-react-class-to-func
description: >-
  Konverter en React class-komponent til funksjonell komponent med hooks.
  Use when: skal konvertere class component til functional component, skal modernisere React-kode.
  Do NOT use for: nye komponenter (skriv funksjonell fra start), refaktorering utover konvertering
disable-model-invocation: true
argument-hint: "[fil-path]"
effort: medium
---

Konverter en React class-komponent til funksjonell komponent med hooks.

**Input:** $ARGUMENTS (fil-path til class-komponenten)

## Argument-parsing

Parse `$ARGUMENTS`:

**Fil-path modus:**
- Eksempel: `/aide-react-class-to-func src/components/UserProfile.tsx`
- Konverter class-komponenten til functional component

**Feilhåndtering:** Hvis argument mangler eller ugyldig format, vis:
```text
Mangler fil-path

Bruk:
/aide-react-class-to-func <fil-path>

Eksempler:
/aide-react-class-to-func src/components/UserProfile.tsx
/aide-react-class-to-func src/sider/Dashboard.tsx
```

---

# Prompt: Konverter React class til functional component

**Formål:** Konverter en klassebasert React-komponent til funksjonell komponent med hooks (tilsvarer `/aide-react-class-to-func` i Claude Code)

---



---

## Prompt

```text
Konverter React class component til functional component med hooks for: <fil-path>

STEG 1: ANALYSER CLASS COMPONENT
- Les filen: <fil-path>
- Identifiser:
  - Lifecycle-metoder (componentDidMount, componentDidUpdate, componentWillUnmount)
  - State (this.state)
  - Props (this.props)
  - Refs (this.refs eller React.createRef())
  - Context (this.context)
  - PureComponent vs Component

STEG 2: PLANLEGG KONVERTERING
Lag mapping-tabell:
- componentDidMount → useEffect(() => {}, [])
- componentDidUpdate → useEffect(() => {}, [deps])
- componentWillUnmount → useEffect cleanup function
- this.state → useState()
- this.props → function parameters
- this.refs → useRef()
- Context → useContext()
- PureComponent → React.memo()

STEG 3: KONVERTER TIL FUNCTIONAL COMPONENT
- Skriv ny functional component
- Konverter lifecycle til hooks
- Konverter state til useState
- Konverter refs til useRef
- Wrap med React.memo() hvis PureComponent

STEG 4: VERIFISER MED TESTER
- Finn eksisterende testfil (f.eks. <fil-path>.test.tsx)
- Kjør: pnpm test -- --run <testfil>
- Verifiser at ALLE tester fortsatt passerer
- Hvis tester feiler: analyser og fiks

STEG 5: OPPDATER IMPORTEN
- Endre class export til const export
- Fjern Component/PureComponent fra imports
- Legg til hooks (useState, useEffect, etc.)

VIKTIG REGLER:
- Følg frontend kodestandard for React-stil
- ALDRI endre business logic - kun konvertering av patterns
- Behold nøyaktig samme props-interface
- Behold nøyaktig samme oppførsel
- Verifiser med tester at oppførselen er identisk

STOPP OG BE OM BEKREFTELSE:
- Etter konverteringsplan er laget (før kodeendring)
- Etter kode er konvertert (før test)
- Etter tester er kjørt (før commit)

Referanse:
- frontend kodestandard → React Hooks
- git-reglene → Bevaring av git-historikk
```

---

## Eksempel

```text
Konverter React class component til functional component med hooks for: src/components/UserProfile.tsx

[... følg stegene over ...]
```

---

## Forventet output

```text
Konvertering fullført for UserProfile.tsx

Konverteringsmapping:
  componentDidMount → useEffect(() => { fetchUser() }, [userId])
  componentDidUpdate → useEffect(() => { updateTitle() }, [user.name])
  componentWillUnmount → useEffect cleanup (clearInterval)
  this.state (user, loading, error) → useState() x3
  this.userRef → useRef()
  PureComponent → React.memo()

Endringer:
  Før: 85 linjer (class-based)
  Etter: 68 linjer (functional with hooks)
  Reduksjon: -17 linjer (-20%)

Test-resultat:
  12/12 tester passerer
  Ingen oppførselsendring detektert

Git:
  modified:   src/components/UserProfile.tsx

Neste steg:
Commit endringene med melding:
"Konverterte UserProfile fra class til functional component

- Lifecycle → useEffect hooks (mount, update, unmount)
- State → useState (user, loading, error)
- Ref → useRef (userRef)
- PureComponent → React.memo
- Alle 12 tester passerer (ingen oppførselsendring)"
```

---

## Konverteringsmønstre

### Lifecycle → useEffect

```typescript
// Før (class)
componentDidMount() {
  this.fetchData();
}

// Etter (functional)
useEffect(() => {
  fetchData();
}, []);
```

### State → useState

```typescript
// Før (class)
state = {
  user: null,
  loading: false
};

this.setState({ loading: true });

// Etter (functional)
const [user, setUser] = useState(null);
const [loading, setLoading] = useState(false);

setLoading(true);
```

### Refs → useRef

```typescript
// Før (class)
inputRef = React.createRef();
this.inputRef.current.focus();

// Etter (functional)
const inputRef = useRef();
inputRef.current.focus();
```

### PureComponent → React.memo

```typescript
// Før (class)
class UserProfile extends React.PureComponent {
  render() { ... }
}

// Etter (functional)
const UserProfile = React.memo(({ userId }) => {
  ...
});
```

---

## Tips

- Start med enkle komponenter først (få lifecycle-metoder)
- Verifiser at tester passerer før og etter
- Bruk TypeScript til å fange type-feil
- Vær obs på dependencies i useEffect (eslint-plugin-react-hooks)
- Bruk useCallback for event handlers hvis nødvendig (unngå re-renders)


---

## Etter konvertering

**Verifiser:**
```bash
pnpm test -- --run <testfil>     # Kjør eksisterende tester
npx tsc --noEmit                  # TypeScript check
```

**Viktig:**
- Alle eksisterende tester MÅ fortsatt passere
- Ingen oppførselsendring skal skje
- Props-interface skal være identisk

**Neste steg:**
- Commit konverteringen med beskrivende melding
- Vurder om flere komponenter kan konverteres
