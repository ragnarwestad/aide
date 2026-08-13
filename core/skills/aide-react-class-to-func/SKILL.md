---
name: aide-react-class-to-func
description: >-
  Convert a React class component to a functional component with hooks.
  Use when: converting a class component to a functional component, modernizing React code.
  Do NOT use for: new components (write functional from the start), refactoring beyond the conversion
argument-hint: "[file-path]"
effort: medium
---

Convert a React class component to a functional component with hooks.

**Input:** $ARGUMENTS (file path to the class component)

## Argument parsing

Parse `$ARGUMENTS`:

**File-path mode:**
- Example: `/aide-react-class-to-func src/components/UserProfile.tsx`
- Convert the class component to a functional component

**Error handling:** If the argument is missing or has an invalid format, show:
```text
Missing file path

Usage:
/aide-react-class-to-func <file-path>

Examples:
/aide-react-class-to-func src/components/UserProfile.tsx
/aide-react-class-to-func src/pages/Dashboard.tsx
```

---

# Prompt: Convert React class to functional component

**Purpose:** Convert a class-based React component to a functional component with hooks (equivalent to `/aide-react-class-to-func` in Claude Code)

---



---

## Prompt

```text
Convert React class component to functional component with hooks for: <file-path>

STEP 1: ANALYZE THE CLASS COMPONENT
- Read the file: <file-path>
- Identify:
  - Lifecycle methods (componentDidMount, componentDidUpdate, componentWillUnmount)
  - State (this.state)
  - Props (this.props)
  - Refs (this.refs or React.createRef())
  - Context (this.context)
  - PureComponent vs Component

STEP 2: PLAN THE CONVERSION
Create a mapping table:
- componentDidMount → useEffect(() => {}, [])
- componentDidUpdate → useEffect(() => {}, [deps])
- componentWillUnmount → useEffect cleanup function
- this.state → useState()
- this.props → function parameters
- this.refs → useRef()
- Context → useContext()
- PureComponent → React.memo()

STEP 3: CONVERT TO FUNCTIONAL COMPONENT
- Write the new functional component
- Convert lifecycle to hooks
- Convert state to useState
- Convert refs to useRef
- Wrap with React.memo() if PureComponent

STEP 4: VERIFY WITH TESTS
- Find the existing test file (e.g. <file-path>.test.tsx)
- Run: pnpm test -- --run <test-file>
- Verify that ALL tests still pass
- If tests fail: analyze and fix

STEP 5: UPDATE THE IMPORTS
- Change class export to const export
- Remove Component/PureComponent from imports
- Add hooks (useState, useEffect, etc.)

IMPORTANT RULES:
- Follow the frontend coding standard for React style
- NEVER change business logic - only convert patterns
- Keep exactly the same props interface
- Keep exactly the same behavior
- Verify with tests that the behavior is identical

STOP AND ASK FOR CONFIRMATION:
- After the conversion plan is made (before code changes)
- After the code is converted (before testing)
- After the tests are run (before commit)

Reference:
- frontend coding standard → React Hooks
- the git rules → Preserving git history
```

---

## Example

```text
Convert React class component to functional component with hooks for: src/components/UserProfile.tsx

[... follow the steps above ...]
```

---

## Expected output

```text
Conversion completed for UserProfile.tsx

Conversion mapping:
  componentDidMount → useEffect(() => { fetchUser() }, [userId])
  componentDidUpdate → useEffect(() => { updateTitle() }, [user.name])
  componentWillUnmount → useEffect cleanup (clearInterval)
  this.state (user, loading, error) → useState() x3
  this.userRef → useRef()
  PureComponent → React.memo()

Changes:
  Before: 85 lines (class-based)
  After: 68 lines (functional with hooks)
  Reduction: -17 lines (-20%)

Test result:
  12/12 tests pass
  No behavior change detected

Git:
  modified:   src/components/UserProfile.tsx

Next step:
Commit the changes with the message:
"Converted UserProfile from class to functional component

- Lifecycle → useEffect hooks (mount, update, unmount)
- State → useState (user, loading, error)
- Ref → useRef (userRef)
- PureComponent → React.memo
- All 12 tests pass (no behavior change)"
```

---

## Conversion patterns

### Lifecycle → useEffect

```typescript
// Before (class)
componentDidMount() {
  this.fetchData();
}

// After (functional)
useEffect(() => {
  fetchData();
}, []);
```

### State → useState

```typescript
// Before (class)
state = {
  user: null,
  loading: false
};

this.setState({ loading: true });

// After (functional)
const [user, setUser] = useState(null);
const [loading, setLoading] = useState(false);

setLoading(true);
```

### Refs → useRef

```typescript
// Before (class)
inputRef = React.createRef();
this.inputRef.current.focus();

// After (functional)
const inputRef = useRef();
inputRef.current.focus();
```

### PureComponent → React.memo

```typescript
// Before (class)
class UserProfile extends React.PureComponent {
  render() { ... }
}

// After (functional)
const UserProfile = React.memo(({ userId }) => {
  ...
});
```

---

## Tips

- Start with simple components first (few lifecycle methods)
- Verify that tests pass before and after
- Use TypeScript to catch type errors
- Watch out for dependencies in useEffect (eslint-plugin-react-hooks)
- Use useCallback for event handlers if needed (avoid re-renders)


---

## After conversion

**Verify:**
```bash
pnpm test -- --run <test-file>   # Run existing tests
npx tsc --noEmit                  # TypeScript check
```

**Important:**
- All existing tests MUST still pass
- No behavior change should occur
- The props interface must be identical

**Next steps:**
- Commit the conversion with a descriptive message
- Consider whether more components can be converted
