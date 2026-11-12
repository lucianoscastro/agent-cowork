---
name: frontend-patterns
description: Frontend architecture patterns for React — component composition, state management, performance optimization, data fetching, forms, and error boundaries. For visual design, tokens, and styling consistency, use design-system instead.
origin: ECC
---

# Frontend Development Patterns

Architecture decisions and patterns for maintainable, performant UIs.

> Atomic React rules (components, hooks, state) and code smells live in the `code-rules` skill. This skill covers the architecture *decisions* — which pattern to choose, and when.

## When to Activate

- Building React components (composition, props, rendering decisions)
- Choosing state management approach
- Optimizing performance (memoization, code splitting, virtualization)
- Working with forms, data fetching, or error boundaries
- Accessibility and responsive design decisions

## Component Architecture Decisions

| Situation | Pattern |
|---|---|
| Reusable UI element | **Composition** (children, slots via props) |
| Group of related components sharing state | **Compound components** (Context + children) |
| Cross-cutting behavior (auth, analytics, logging) | **Custom hook** (preferred over HOC) |
| Data fetching for a component tree | **Container/presenter** or **custom hook** |
| Complex conditional rendering | **Extract to named components** (not ternary chains) |

### Rules
- One component per file when reusable
- Stateless when possible. Lift state only as high as needed
- Max ~80 lines per component. Split if larger

## State Management Decision

| State type | Solution |
|---|---|
| Ephemeral UI (toggle, hover, animation) | `useState` / `useReducer` |
| Form state | Controlled inputs + `useState` or form library |
| Shared between siblings | Lift to parent |
| Shared across distant components | Context (small), Zustand/Jotai (medium), Redux (large) |
| Server state (API data) | React Query / SWR / Apollo Client |
| URL state | Router params / search params |

### Rules
- Server state is NOT client state. Use a data-fetching library, not Redux
- Don't duplicate server state in local state (stale data risk)
- Context is for low-frequency updates. High-frequency updates cause full subtree re-renders
- Prefer derived/computed values over stored redundant state

## Performance Optimization

### When to optimize (not before)

| Signal | Action |
|---|---|
| Measured slow render (>16ms) | Profile with React DevTools, find cause |
| Large list (100+ items) | Virtualization (`@tanstack/react-virtual`) |
| Heavy computation in render | `useMemo` with correct deps |
| Callback causing child re-renders | `useCallback` + `React.memo` on child |
| Large bundle | Code split with `lazy()` + `Suspense` |
| Expensive component tree | `React.memo` at strategic boundaries |

### Rules
- Never optimize without measuring first
- `useMemo`/`useCallback` have cost. Only use when preventing measurable re-renders
- `React.memo` prevents re-render ONLY if props are referentially stable
- Key prop must be stable and unique (never use array index for dynamic lists)

## Data Fetching Patterns

| Approach | When |
|---|---|
| **React Query / SWR** | REST APIs, caching, pagination, optimistic updates |
| **Apollo Client** | GraphQL APIs |
| **Server Components** | Next.js/RSC, data needed at render time |
| **`useEffect` + fetch** | Simple one-off fetch (avoid for anything complex) |

### Rules
- Loading, error, and empty states must ALL be handled
- Show stale data while revalidating (stale-while-revalidate)
- Deduplicate concurrent requests for the same resource
- Paginate or virtualize large datasets

## Form Handling

| Complexity | Approach |
|---|---|
| 1-3 fields, simple validation | Controlled inputs + `useState` |
| 4+ fields, complex validation | Form library (React Hook Form, Formik) |
| Schema validation | Zod / Yup with form library integration |

### Rules
- Validate on blur (not keystroke) for UX
- Show errors next to the field, not in a toast
- Disable submit during submission (prevent double-submit)
- Handle server-side validation errors (map to fields)

## Error Boundaries

- Wrap major sections (sidebar, main content, modals) independently
- Never wrap the entire app in a single boundary
- Provide "retry" action in fallback UI
- Log errors to monitoring service in `componentDidCatch`
- Error boundaries don't catch: event handlers, async code, server-side rendering

## Accessibility Principles

- Semantic HTML first (button, nav, main, section) before ARIA
- All interactive elements keyboard-accessible (focus visible, tab order)
- Color is never the sole indicator (add icons or text)
- Contrast ratio >= 4.5:1 for text
- Touch targets >= 44x44px on mobile
- Images need alt text (decorative images: `alt=""`)
- Focus management: trap focus in modals, restore on close
- Test with keyboard-only navigation
