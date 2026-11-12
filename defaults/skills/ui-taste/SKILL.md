---
name: ui-taste
description: "Art direction and anti-slop craft for web UI: grounds a design in its subject, commits to a deliberate direction (palette, type, layout, one signature move, motion, copy voice), builds or fixes UI so it does not read as AI-generated, and checks it with a scanner for generated-UI tells. Use whenever you build, design, redesign, restyle or polish a landing page, site, app screen, dashboard, form, component, HTML artifact or mockup, new or inside an existing React, Next.js, Vue, Svelte or Tailwind codebase; when asked for design options or variants; or when a UI looks generic, templated, bland or AI-made ('parece feito por IA', 'genérico', 'sem personalidade', 'deixa mais bonito', 'melhora o visual'). Disambiguation - to generate or audit design tokens and consistency of an existing system use design-system; for React architecture and state use frontend-patterns; for chart colors use dataviz; for real-browser QA use browser-qa."
origin: custom
---

# UI Taste

Generated interfaces are recognisable because every model reaches for the same median choice on every axis: the safe face, the template hero, the three cards, the stock sentence. None of these is wrong on its own; together, and regardless of subject, they read as "nobody decided anything". This skill turns each of those choices into a decision you can defend from the brief, then checks the result for the tells.

Two rules sit above everything else:

- **The brief's own words win.** If it asks for a purple gradient, Inter or a centred hero, do that, and do it well. Everything below governs only the axes the brief leaves free.
- **Distinct does not mean loud.** A quiet, exact page made for its subject beats a maximal one made for no one. Intensity is a dial; intentionality is the requirement.

## Pick the mode

| Situation | Mode | First move |
|---|---|---|
| New page, site, screen, component, artifact or mockup, no design system to follow | **Direction** | The whole workflow below |
| Inside a product that already has tokens, a component library or a brand | **System-bound** | Step 2 first; the system is a hard constraint |
| "Looks generic / AI-made / sem personalidade", or a redesign of existing UI | **De-slop** | Run the scan (step 6), read `references/slop-catalog.md`, then steps 3 to 7 |
| The user wants options, directions or variants | **Variants** | Step 3, one direction sheet per variant |

Modes combine: redesigning a screen of an existing app is De-slop plus System-bound.

## Workflow

### 1. Read the brief

Before anything else, write one line:

> Reading this as: [kind of thing] for [audience], whose job is [the one action or decision], in a [register] voice.

The kind of thing decides the toolbox, so name it precisely: a place people visit (cafe, clinic, shop), a physical product, a service people hire, software or a developer tool, an editorial or personal site, an internal tool or dashboard. Photographs and type carry a bakery; the live product carries software; shaders and effects belong only where the subject is technical; a dashboard earns density, not decoration.

If the subject, audience or job is unknown and cannot be inferred, propose one concrete answer and ask a single question. Otherwise state the read and proceed.

### 2. Inventory what exists

Look before choosing:

- **Tokens:** CSS custom properties, Tailwind config or `@theme`, `globals.css`, theme files, a `DESIGN.md`.
- **Components:** the library in use (shadcn/ui, MUI, Ant, Chakra, a local `components/ui`) and the existing page closest to what you are building.
- **Brand:** logo files, colours, fonts, photographs, product screenshots.
- **Content:** real copy, prices, names, data, addresses. Real content is the strongest anti-template device there is; invented content is the strongest tell.

When a system exists (System-bound):

- Its fonts, colours, radii, spacing and components are the vocabulary; do not add new ones. Distinctiveness here comes from hierarchy, composition, density, content, states and copy, which is where generated UI is weakest anyway.
- Reuse the real shell and components; change the look through tokens, never by forking components.
- The real logo renders wherever a logo slot exists: never initials, an emoji, a generic mark or an invented SVG in its place.
- If the system itself is the generic default (untouched shadcn zinc, stock MUI blue) and the user wants it less generic, propose one token-level change instead of per-screen overrides. The `design-system` skill generates and audits tokens.

### 3. Plan the direction

**Mine the subject first.** List 3 to 5 anchors: concrete things from the subject's world, such as its materials, artefacts, documents, signage, tools, places, era, and the way things move in it. A freight tracker: waybills, container stencils, dock signage, barcode labels. A ceramics studio: glaze test tiles, kiln cones, raw clay, the wheel. Anchors feed every choice below as logic, not costume: borrow the waybill's grid and its carbon-copy blue, not a fake paper texture.

**Write the direction sheet.** It is a working tool of a dozen lines, not a deliverable:

```text
Read:      the one-line read from step 1
Anchors:   3-5 concrete things from the subject's world
Dials:     variance 1-10, motion 1-10, density 1-10
Palette:   4-6 named tokens with values and roles (ground, surface, ink, muted, accent;
           state colours for product UI), each traced to an anchor
Type:      faces and roles (one family, or display + text) and why each fits; scale ratio; measure
Layout:    the concept in one sentence; an ASCII wireframe of the first screen; one line per
           section with its one idea and its layout family
Signature: the one memorable move, and what stays quiet so it lands
Shape:     radius rule by hierarchy; how groups separate (space, ground change, rule, card)
Motion:    each movement and its purpose; everything else still
Voice:     register, the brief's own nouns, what the copy never does
Replaced:  your first instinct on each axis and what replaced it, or why it stayed
```

Dial anchors: a calm SaaS or editorial page sits near 5/3/3, an agency or launch page near 8/7/3, a trust-first public service near 3/2/5, most product UI near 3/2/6.

**Check the plan for defaults before building.** The `Replaced` line is the engine; fill it honestly.

1. *First instinct.* For each axis, what would you have picked for any similar brief? If the plan still holds it, it is a default rather than a choice: replace it, or keep it with a reason that comes from this brief.
2. *Nine briefs.* Picture this exact direction on nine unrelated briefs. If it suits most of them, it is a template; push it toward the anchors.
3. *Catalog.* Compare with the short list below (the full one is `references/slop-catalog.md`). A match stays only when the brief asked for it.
4. *Rotation.* If you designed something unrelated earlier in this session, take the option least like it on every free axis: escaping one default by always landing on the same "distinctive" alternative only makes a new default. Within one product the opposite holds: follow its recorded direction.

Read `references/type-color.md` and `references/layout-motion.md` while filling the sheet, and `references/product-ui.md` for apps, dashboards, forms and internal tools.

**Variants.** One direction per variant, each along a named axis (type-led editorial, product in use, dense power-user), each with its own short sheet saying what changes and what is shared (content, system, brand). Never colour swaps of one layout. Two by default, three at most. Once the user picks one, stop branching and refine it.

### 4. Write the copy first

Words make a page look as templated as its layout does, and the layout should be composed around real content. Draft the actual words before building: the headline names the thing and who it is for, one hard fact sits on the first screen, every heading carries a noun, every button is a verb and an object. Never invent testimonials, client logos, metrics or awards; use the brief's facts or write a plainer line. Rules, voice registers and the device budget are in `references/copy.md`.

### 5. Build

- Tokens first: colours, faces, sizes, spacing, radii and durations as custom properties (or the project's theme); components read tokens, never raw values. On a new project, record the read, anchors and signature in a short comment at the top of the main stylesheet so the next screen follows the same direction.
- Load only the font files you use (four at most), with `font-display: swap`, a metric-matched fallback, and the display face preloaded when it is above the fold.
- Compose the 390px layout on purpose instead of letting it stack; check 1440, 1024, 768 and 390. Use `svh` for full-height sections.
- Watch selector specificity: section-level and element-level classes overriding each other's padding is a classic generated-CSS bug.
- Quality floor, never announced: landmarks and heading order, visible focus, labelled controls, alt text, 44px targets, contrast (body 4.5:1, large text and UI 3:1), `prefers-reduced-motion` honoured, no layout shift from fonts or images.
- Spend boldness in one place, the signature, and keep everything around it disciplined.

### 6. Critique

1. **Scan** what you built, or the code you were asked to fix (Python 3, standard library only):

   ```bash
   python3 <this-skill-dir>/scripts/slop_scan.py <files-or-dirs>
   ```

   A flag is a question, not a verdict: fix it, or keep it and say why. Swapping a flagged word for a synonym, or Inter for the next fashionable face, is not a fix; it is the next tell.
2. **Look at the render** when your environment can (a browser tool, Playwright, the `browser-qa` skill): the first screen at 1440 and 390 plus one full-page shot, judged against the direction sheet and the checklist below. If you cannot see it, say so; never imply you checked.
3. **Remove one accessory.** Find the decoration that serves nothing in the brief and cut it.

### 7. Report

Keep it short: the read; the direction (palette, type, layout concept, signature) and why it fits this subject; the defaults you replaced; scan flags kept and why; what you could not verify; what the user must supply (real photographs, logo, the facts behind any copy). Close with two or three concrete next directions specific to this design, not a generic menu.

## Generated looks, short list

Defaults, not choices: they appear whatever the subject, which is what gives them away. The full catalog, with the move that replaces each, is `references/slop-catalog.md`.

- **The 2023 kit:** Inter, Roboto or the system stack as the brand face; purple-to-blue or indigo gradients; a centred hero with a pill badge, gradient headline and two buttons; three identical feature cards with icons in tinted circles; glass cards; emoji as icons; `hover:scale-105` on everything; "Trusted by" logos, three testimonials, three pricing tiers with "Most popular".
- **The new defaults** (what anti-slop prompts produced): a warm cream ground with a high-contrast serif and a terracotta accent; a near-black ground with one acid-green or vermilion accent; broadsheet hairlines, zero radius and dense columns; one italic or coloured word in the headline; a tracked all-caps label above every heading; `01 / 02 / 03` on content that is not a sequence; `A · B · C` meta lines; monospace for small labels; an arrow after every link; grain and aurora gradients as atmosphere; bento grids and marquees; Space Grotesk, Geist, Satoshi, Instrument Serif or Fraunces chosen because they are "not Inter".
- **Product UI:** a sidebar, four KPI cards with green "+12.5%" chips, a line chart and "Recent transactions" on every dashboard; everything boxed, cards inside cards; untouched library defaults; gradient avatar circles; spinners instead of skeletons; emoji empty states; a toast for every action.
- **Copy:** Elevate, Unlock, Seamless (Eleve, Potencialize, sem complicação); invented specifics and round unsourced stats; "X. Y." two-fragment headings; "not X but Y" and its substitutes; virtue words (honest, calm, simply); a dry quip closing every paragraph; the default cast (Acme, Priya, Okafor).

## Before you finish

- [ ] Someone shown only a screenshot could guess the subject without reading the headline.
- [ ] The first screen says what this is and for whom, with one hard fact, and the main action is visible.
- [ ] One signature move, and nothing competes with it.
- [ ] One accent with a job; neutrals drawn from the palette's hue; contrast computed, not eyeballed.
- [ ] One family or two clearly distinct ones with fixed roles, a real scale, a measure under about 70 characters, sentence case.
- [ ] Layout families vary down the page; edges align to one grid; no section is a template of the one before.
- [ ] Cards only where the group is a real object; two levels of boxes at most; radius follows hierarchy.
- [ ] Every motion has a stated purpose; interactive things respond and static things stay still; with reduced motion everything is still readable.
- [ ] No invented facts, quotes, logos or metrics; buttons are a verb and an object; empty and error states are written.
- [ ] Scan run, every flag fixed or justified; render reviewed at desktop and mobile, or the report says it was not.

Synthesised from Anthropic's `frontend-design` (Apache-2.0), Leonxlnx's `taste-skill` / `design-taste-frontend` 2.5.1 (MIT) and superdesign's `superdesign-skill` (MIT). The product-UI rules, the Portuguese copy tells and the scanner are additions.
