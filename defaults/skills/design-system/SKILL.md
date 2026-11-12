---
name: design-system
description: Generate or audit design systems and design tokens, check visual consistency, and review PRs that touch styling — the visual layer (colors, typography, spacing, aesthetic). Also holds a catalog of 12 ready visual presets for presentation and landing-page work (STYLE_PRESETS.md). Disambiguation - for React component architecture, state management, and performance use frontend-patterns; for chart, plot, dashboard, or data-visualization color (categorical/sequential/diverging palettes, stat tiles, legends, axes) use the built-in dataviz skill, which owns chart color decisions.
origin: ECC
---

# Design System — Generate & Audit Visual Systems

## When to Use

- Starting a new project that needs a design system
- Auditing an existing codebase for visual consistency
- Before a redesign — understand what you have
- When the UI looks "off" but you can't pinpoint why
- Reviewing PRs that touch styling

## How It Works

### Mode 1: Generate Design System

Analyzes your codebase and generates a cohesive design system:

```
1. Scan CSS/Tailwind/styled-components for existing patterns
2. Extract: colors, typography, spacing, border-radius, shadows, breakpoints
3. Research 3 competitor sites for inspiration when current web/browser tooling is available
4. Propose a design token set (JSON + CSS custom properties)
5. Generate DESIGN.md with rationale for each decision
6. Create an interactive HTML preview page (self-contained, no deps)
```

Output: `DESIGN.md` + `design-tokens.json` + `design-preview.html`

### Mode 2: Visual Audit

Scores your UI across 10 dimensions (0-10 each):

```
1. Color consistency — are you using your palette or random hex values?
2. Typography hierarchy — clear h1 > h2 > h3 > body > caption?
3. Spacing rhythm — consistent scale (4px/8px/16px) or arbitrary?
4. Component consistency — do similar elements look similar?
5. Responsive behavior — fluid or broken at breakpoints?
6. Dark mode — complete or half-done?
7. Animation — purposeful or gratuitous?
8. Accessibility — contrast ratios, focus states, touch targets
9. Information density — cluttered or clean?
10. Polish — hover states, transitions, loading states, empty states
```

Each dimension gets a score, specific examples, and a fix with exact file:line.

### Mode 3: AI Slop Detection

Identifies generic AI-generated design patterns:

```
- Gratuitous gradients on everything
- Purple-to-blue defaults
- "Glass morphism" cards with no purpose
- Rounded corners on things that shouldn't be rounded
- Excessive animations on scroll
- Generic hero with centered text over stock gradient
- Sans-serif font stack with no personality
```

### Mode 4: Pick a Ready Preset

`STYLE_PRESETS.md` holds 12 named visual presets (palette, type pairing, animation feel) plus mandatory base CSS, viewport density limits, and a mood-to-preset map. Use it when the task is "make this look good" and there is no existing system to extract from — slide decks, landing pages, one-off HTML. Read that file before inventing a palette from scratch.

## Examples

Invoke the skill in natural language and name the mode plus any details:

- **Generate** — "generate a design system, minimal style, earth-tone palette"
- **Audit** — "audit the UI at http://localhost:3000, pages /, /pricing, /docs"
- **Slop check** — "check this UI for generic AI-generated design patterns"
- **Preset** — "build these slides with a bold, high-contrast look" → pick from `STYLE_PRESETS.md`
