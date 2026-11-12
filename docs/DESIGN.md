---
version: 1
name: agentcowork-design
description: A calm, content-first admin console. Parchment canvas, white hairline cards, near-black ink and a single Action Blue for everything clickable. Chrome recedes — a thin black global nav and a frosted sub-nav — so the state of the agents and the work waiting for a person read first. No gradients, no shadows on chrome.

colors:
  primary: "#0066cc"
  primary-focus: "#0071e3"
  primary-on-dark: "#2997ff"
  ink: "#1d1d1f"
  ink-muted: "#6e6e73"
  canvas: "#f5f5f7"
  surface: "#ffffff"
  hairline: "#e0e0e0"
  code: "#f0f0f2"
  nav: "#000000"
  on-nav: "#f5f5f7"
  on-primary: "#ffffff"
  ok: "#1d7a4b"
  warn: "#9a6200"
  bad: "#b3261e"
  dark-canvas: "#000000"
  dark-surface: "#1c1c1e"
  dark-hairline: "#38383a"
  dark-ink: "#f5f5f7"
  dark-ink-muted: "#a1a1a6"

typography:
  family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"
  display: { fontSize: 40px, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.374px }
  page-title: { fontSize: 34px, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.374px }
  section-title: { fontSize: 24px, fontWeight: 600, letterSpacing: -0.374px }
  sub-nav-title: { fontSize: 21px, fontWeight: 600, letterSpacing: 0.231px }
  lead: { fontSize: 17px, fontWeight: 400, lineHeight: 1.47 }
  card-title: { fontSize: 17px, fontWeight: 600, letterSpacing: -0.374px }
  body: { fontSize: 15px, fontWeight: 400, lineHeight: 1.47, letterSpacing: -0.2px }
  dense: { fontSize: 14px, fontWeight: 400, letterSpacing: -0.224px }
  caption: { fontSize: 12px, fontWeight: 400 }
  nav-link: { fontSize: 13px, fontWeight: 400, letterSpacing: -0.12px }
  mono: "ui-monospace, 'SF Mono', Menlo, monospace"

rounded:
  sm: 8px
  md: 12px
  lg: 18px
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px

components:
  global-nav: { backgroundColor: "{colors.nav}", textColor: "{colors.on-nav}", typography: "{typography.nav-link}", height: 44px }
  sub-nav: { backgroundColor: "canvas at 80% + backdrop blur", textColor: "{colors.ink}", height: 52px }
  live-bar: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", typography: "{typography.dense}" }
  card: { backgroundColor: "{colors.surface}", border: "1px solid {colors.hairline}", rounded: "{rounded.lg}", padding: "20px 24px" }
  button-primary: { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", rounded: "{rounded.pill}", padding: "7px 20px" }
  button-utility: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", border: "1px solid {colors.hairline}", rounded: "{rounded.sm}", padding: "7px 14px" }
  button-danger: { backgroundColor: "{colors.surface}", textColor: "{colors.bad}", border: "1px solid {colors.hairline}", rounded: "{rounded.sm}" }
  tab: { backgroundColor: "{colors.surface}", border: "1px solid {colors.hairline}", rounded: "{rounded.pill}", padding: "6px 16px" }
  tab-active: { backgroundColor: "{colors.ink}", textColor: "{colors.canvas}", rounded: "{rounded.pill}" }
  badge: { border: "1px solid currentColor", rounded: "{rounded.pill}", typography: "{typography.caption}" }
  input: { backgroundColor: "{colors.surface}", border: "1px solid {colors.hairline}", rounded: "{rounded.sm}", padding: "8px 10px" }
  meter: { track: "{colors.hairline}", fill: "{colors.ok} / {colors.warn} at 70% / {colors.bad} at 90%", height: 8px, rounded: "{rounded.pill}" }
---

# agentCowork design system

## Overview

agentCowork is an operations console: a person opens it to learn **what needs them** and **whether the agent team is working**, then leaves. The interface is built to make those two answers obvious and everything else quiet.

### Key characteristics

- Content first: state, counts and the work waiting for a person carry the page; chrome recedes.
- One accent. `{colors.primary}` (Action Blue) marks every interactive element — links, primary buttons, focus. Nothing decorative uses it.
- Status colors are semantic only: `{colors.ok}`, `{colors.warn}`, `{colors.bad}` say how something *is*, never what to click.
- Parchment canvas, white cards with a hairline border, near-black ink. Depth comes from surface change, not shadows.
- Two button grammars: a pill for the one primary action of an area, compact 8px rectangles for utility actions.
- Tight, slightly negative tracking on titles; body at 15px because the console is mostly tables and forms.

## Information architecture

Screens are grouped by intent in a thin black **global nav**; the pages of the current group sit in a frosted **sub-nav** below it.

| Group | Pages | Question it answers |
| --- | --- | --- |
| Home | Today | What waits for me? Is the team working? |
| Work | Inbox · Runs · Findings | What needs a decision, and what did the agents do? |
| Team | One page per agent (Overview · Settings · Prompts) | What does this agent do, how is it set, why is it off? |
| Setup | Projects · Accounts · General · Instructions | What does the instance work on, and as whom? |
| History | Usage · Activity | What did it cost, how close are the account limits, who changed what? |

Rules that hold on every page:

- **State with a reason.** Anything off or failing says why, and links to where it is fixed.
- **Live is always visible.** A bar under the navigation names the agents that write to GitHub and Jira.
- **Tabs and sub-pages are addresses** (`#/agents/developer/settings`), so back, forward and links work.
- **Save per section**, with its own result message; destructive actions ask first and say what will happen.
- **Empty states say what to do next**; Home keeps a setup checklist until the instance can work.

## Colors

### Accent

- **Action Blue** (`{colors.primary}` #0066cc): links, primary buttons, the active sub-nav item, checkboxes. The only interactive color.
- **Focus Blue** (`{colors.primary-focus}` #0071e3): the 2px keyboard focus ring.
- **Sky Blue** (`{colors.primary-on-dark}` #2997ff): Action Blue's dark-theme counterpart, used wherever the dark theme puts an accent.

### Surfaces and text

- **Parchment** (`{colors.canvas}` #f5f5f7): the page canvas.
- **White** (`{colors.surface}`): cards, inputs, tabs.
- **Hairline** (`{colors.hairline}` #e0e0e0): card and input borders, table rules.
- **Ink** (`{colors.ink}` #1d1d1f): all text; **Ink Muted** (`{colors.ink-muted}` #6e6e73) for secondary text, chosen for 4.5:1 contrast on parchment.
- **Black** (`{colors.nav}`): the global nav only.

### Status

`{colors.ok}`, `{colors.warn}` and `{colors.bad}` (with lighter dark-theme variants) appear in badges, meters, reasons and messages. Severity chips on findings keep their own fixed scale (critical, high, medium, low).

### Dark theme

Follows the operating system. Canvas `{colors.dark-canvas}`, cards `{colors.dark-surface}`, hairlines `{colors.dark-hairline}`, ink `{colors.dark-ink}`, muted `{colors.dark-ink-muted}`, accent `{colors.primary-on-dark}`. The global nav gains a hairline so it separates from the black canvas.

**No gradients, anywhere.**

## Typography

One system stack (`{typography.family}`): the platform UI font, with Inter as the closest open fallback.

| Token | Size | Weight | Use |
| --- | --- | --- | --- |
| `display` | 40px | 600 | Home and agent page heroes |
| `page-title` | 34px (28px on phones) | 600 | Page titles; Home's "waiting for you" count |
| `section-title` | 24px | 600 | Sections inside a page (e.g. Accounts → Agent runtimes) |
| `sub-nav-title` | 21px | 600 | The group name in the sub-nav |
| `lead` | 17px | 400 | The paragraph under a page title |
| `card-title` | 17px | 600 | Card headers |
| `body` | 15px | 400 | Default text |
| `dense` | 14px | 400 | Tables, buttons, inputs, tabs |
| `nav-link` | 13px | 400 | Global and sub-nav links |
| `caption` | 12px | 400 | Hints, table headers, timestamps |

Principles: weights are 400 and 600 only; titles carry slight negative tracking; body line height stays at 1.47; numbers in tables are tabular and right-aligned.

## Layout

- **Base unit 8px**; structural spacing snaps to 8/12/16/24/32.
- **Content width** 1200px, centered, 24px side padding (16px on phones). Global nav, sub-nav, live bar and content share it.
- **Page rhythm:** title → lead → cards stacked with 20px gaps. Cards hold 20×24px padding (16px on phones).
- **Grids:** agent cards fill columns of at least 205px (five across on desktop); limits and tiles at least 200–240px.

## Elevation

| Level | Treatment | Use |
| --- | --- | --- |
| Flat | No border | Canvas, page titles |
| Hairline | 1px `{colors.hairline}` | Cards, inputs, tabs, tables |
| Frosted | Canvas at 80% + `saturate(180%) blur(20px)` | Sub-nav, which stays pinned under the global nav |

No drop shadows on any UI element.

## Shapes

| Token | Value | Use |
| --- | --- | --- |
| `sm` | 8px | Utility buttons, inputs, code blocks |
| `md` | 12px | Sub-cards inside a card |
| `lg` | 18px | Cards |
| `pill` | 9999px | Primary buttons, tabs, badges, meters, the active global-nav group |

Don't mix grammars: a control is either a pill or an 8px rectangle.

## Components

- **Global nav** — black, 44px, sticky. Brand and instance name, the five groups (the active one on a translucent white pill; Work carries the inbox count), log out on the right.
- **Sub-nav** — frosted, 52px, sticky under the global nav. Group name on the left at `sub-nav-title`, the group's pages on the right; the current one in Action Blue. Hidden on Home.
- **Live bar** — a white strip under the navigation listing live agents with a `warn` badge. Absent while every agent is in dry run.
- **Card** — white, hairline, 18px radius. Optional header with a `card-title` and actions on the right.
- **Agent card** — a card that links to the agent: name, on/off and live/dry-run badges, a one-line summary, the reason it is off in `warn`, last poll in `caption`.
- **Primary button** — Action Blue pill. At most one per area (Open the inbox, Run now, Save).
- **Utility button** — white 8px rectangle with a hairline; hover outlines it in Action Blue. **Danger** variant uses `bad` text.
- **Tabs** — pills; the active one inverts to ink on canvas.
- **Badge** — outlined pill in the status color: on, off, live, dry run, Available, Paused.
- **Meter** — 8px pill track; fill turns `warn` at 70% and `bad` at 90%. Exposed as a progressbar with a label.
- **Inputs** — white, hairline, 8px radius; focus replaces the border with a 2px Focus Blue outline. Checkboxes use the accent color.
- **Tables** — hairline rules, 14px text, 12px muted headers, no rule under the last row.
- **Terminal** — the live run output keeps its own dark palette in both themes.

Press feedback on every button: `transform: scale(0.97)`, disabled under `prefers-reduced-motion`.

## Do and don't

### Do

- Use Action Blue for everything clickable and for nothing else.
- Give every off, failed or blocked state a reason and a way to fix it.
- Keep one primary (pill) action per area; everything else is a utility button.
- Use tokens (`var(--accent)`, `var(--line)`…) — never inline hex in components.
- Check each screen in light, dark and at phone width.

### Don't

- Add a second accent or use status colors for actions.
- Add shadows or gradients to cards, buttons or text.
- Use weights other than 400 and 600, or body text below 14px.
- Hide that an agent is live.

## Responsive behavior

| Width | Changes |
| --- | --- |
| > 833px | Full layout |
| ≤ 833px | 16px side padding; global nav and sub-nav scroll horizontally (scrollbar hidden); the instance name hides; page titles drop to 28px; fields take the full width; the instructions viewer stacks |

Touch targets stay at least 34px high; the primary pill is the largest target in its area.
