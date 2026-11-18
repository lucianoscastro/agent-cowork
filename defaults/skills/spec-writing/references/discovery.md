# Discovery

Only when the run's prompt asks for a discovery: work that is explored and approved before anything is specified, such as rethinking how a product looks and flows. People approve it on the card, and nothing is built from it. Once it is approved, they create the cards that build it as children of the discovery's card, and each one gets its own spec with this discovery as its source.

A discovery decides the direction, not the details: no EARS criteria, tasks or ADRs. Each child card gets those when it is specified.

## Files

- `discovery.md`, always, with the template below.
- `mockup-<area>.html` when the discovery changes what people see: the main screens in the proposed direction, as [mockups.md](mockups.md) says under "In a discovery". One file per area of the product (`mockup-orders.html`, `mockup-settings.html`).

## Method

1. **Read what exists.** The card whole, the project's recorded decisions and the code: today's screens and flows, their components, tokens and styles, and the data each screen shows. A discovery that does not know what exists proposes what is already there, or what cannot be built.
2. **Ask first** ([questions.md](questions.md)): who it is for and why, when the card does not say; which screens and users are in scope; and a choice between directions that changes what users get, the cost or the time. Two directions people must choose between are one question, each with its effect; the prototypes show the one they chose.
3. **The problem and today**: who struggles with what now, what must not get worse, and the screens in scope as the code has them.
4. **The direction**, then screen by screen: the principles that decide the details, and what each screen becomes.
5. **The technical analysis** against the code: what each screen reuses, what changes underneath, what is new, the risks, and the relative effort.
6. **The proposed cards**: the slices someone can specify and build one at a time.
7. **The prototypes** of the main screens.
8. **Before finishing**: read the card again, one sentence at a time; each lands in the discovery, `Out of scope` or an open question. Then run the checklist below over your own documents.

## Template

````markdown
# <Discovery title>

## Problem
<present tense: who struggles with what today, and what must not get worse for them>

## Today
<the screens and flows in scope as the code has them: what each shows and does, the components and tokens they use, and what makes them hard to use; cite the code (`ui/src/pages/Orders.tsx`)>

## Direction
<the proposal in a few sentences: the principles that decide the details (what comes first on a screen, how navigation works, the visual language)>

## Screens
| Screen | Today | Proposed | Prototype |
|---|---|---|---|
| Orders list | <one line> | <one line> | mockup-orders.html |

## Technical analysis
- **Reused**: <components, routes and data that stay>
- **Changes**: <what changes underneath: shared components, tokens, routes, data a screen needs that no endpoint gives today>
- **New**: <what does not exist yet>
- **Risks**: <what can break, for whom, and which proposed card contains it>
- **One-way doors**: <a decision hard to reverse the children will face (stored data, a contract, a dependency): named here, decided in that child's ADR>

## Proposed cards
| # | Card | Covers | Depends on | Size |
|---|---|---|---|---|
| 1 | <a change someone can build and ship on its own> | <screens or parts of the direction> | - | S |

## Out of scope
- <what the discovery leaves out, and why>

## Assumptions
| Assumption | Confirmed? | Rationale |
|---|---|---|

## Open questions
None.

## Sources
- Prototype: mockup-orders.html (Orders list, Order detail)
````

- **Size** is relative, never hours: S (one area, a few days), M (a week or two), L (more: split it if you can).
- **A proposed card is one card, one spec**: it ships something people can see or use on its own. A card per layer (all the tokens, then all the screens) is not a slice; a shared change the others need (the new tokens and base components) is the first card.
- **The cards are a proposal**: people create them as children of the discovery's card, and may merge or split them.
- A decision people must take before a child card can be specified, and that the discovery leaves open, is an open question with what it blocks: `- Q4 - Keep the old screens behind a switch? - blocks card 3`.

## Review checklist

- **Coverage**: each sentence of the card lands in the discovery, `Out of scope` or an open question; each answer on the card is reflected.
- **Today**: what it says exists does, cited from the code; nothing the code contradicts.
- **Gray areas**: none settled by an assumption; who and why, the scope and a choice between directions were asked when they change what gets built.
- **Direction**: concrete enough to decide from; every screen in `## Screens` has its today and its proposal.
- **Technical analysis**: the reuse, the changes, the new parts and the risks follow from the code; each one-way door is named; effort is relative.
- **Proposed cards**: each ships on its own, they are ordered by dependency, and together they cover the direction.
- **Prototypes**: when the discovery changes what people see, every screen in `## Screens` is drawn and reachable, in the proposed look, with fictional data, a banner, named under `## Sources`, and no web address. A missing one is major.
- **Hygiene**: no EARS criteria, tasks or ADRs; no secrets or personal data; headings in English, prose in the run's language.

Severity as in [review.md](review.md): a blocker when people would approve what they cannot see, or what the code cannot support; major when a screen, a prototype, a risk or a proposed card is missing or wrong; minor for clarity.
