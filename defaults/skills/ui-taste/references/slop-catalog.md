# Slop catalog

The tells of generated UI, why each one reads as generated, and the move that replaces it. Use it in the plan's defaults check and, in De-slop mode, to name what you found (with file and line).

Dated November 2026. Tells shift with every model generation, and every rule that bans one breeds a substitute (section 6), so learn why each reads as generated rather than memorising the list. One tell proves little; clusters and repetition are the signal.

The fix is a decision, never a synonym. Swapping Inter for Geist, "Elevate" for "Enhance" or purple for teal keeps the template and changes its paint. Change the thing the default was standing in for.

## Contents

1. Why defaults happen
2. Visual tells, first generation
3. Visual tells, second generation
4. Product UI tells
5. Copy tells
6. Over-correction
7. Not tells

## 1. Why defaults happen

A model picks the option that fits the most pages, and tuning smooths it further toward safe. With no facts about the subject, it fills a template with plausible inventions. So the cure is input and decisions: the subject's anchors, the brief's real content, and a written reason for every choice. A rule that only bans a habit pushes the model to the nearest neighbour of that habit, so every ban below comes with a move.

## 2. Visual tells, first generation (the 2023-24 kit)

| Tell | Why it reads as generated | Move |
|---|---|---|
| Inter, Roboto, Open Sans, Poppins, Montserrat or the system stack as the brand face | The zero-decision choice | Find the face through the subject's vernacular (`type-color.md` section 1) |
| Purple-to-blue gradients; indigo or violet as the primary (Tailwind `indigo-500`, `violet-600`) | The template palette, which now reads as "AI product" | A palette from the anchors; one accent with a job |
| Gradient text on the headline | Decoration standing in for a message | Size, weight, position and the words themselves |
| Centred hero: pill badge ("New"), headline, sub-line, two buttons, a screenshot in a tilted gradient frame | The median landing page | Open with the most characteristic thing in the subject's world (`layout-motion.md` section 2) |
| Three identical feature cards: icon in a tinted circle, title, two lines | Equal weight means no hierarchy | Rank the features; give the main one the space; list the rest |
| Glass cards (`backdrop-blur`) | An effect without a reason | Flat surfaces; blur only for overlays above moving content |
| Emoji as icons, bullets or garnish | No icon system | One icon set at one stroke weight, or no icons |
| `hover:scale-105`, `shadow-xl` and `transition-all` on every card | Motion that means nothing | Interactive things answer subtly; static things stay still |
| Blurred blobs, mesh gradients, floating orbs | Atmosphere where content should be | A real photograph, the product itself, or nothing |
| "Trusted by" logo strip, three testimonials, three tiers with "Most popular", FAQ accordion, gradient CTA band, four-column footer, in that order | The section template | Shape the sections from the reader's questions |
| `rounded-2xl` and `shadow-lg` on everything | One radius regardless of hierarchy | Radius by size and role; shadows only on things that float |
| Stats strip: 10k+ users, 99.9% uptime, 24/7 support | Invented proof | Only the brief's figures, each in the sentence it proves |
| Checkmark lists for every feature set | Filler structure | A sentence, a table, or a real comparison |

## 3. Visual tells, second generation (the new defaults)

Mostly produced by prompts that banned the first generation. They look tasteful, which is why they survive review.

| Tell | Why it reads as generated | Move |
|---|---|---|
| Warm cream ground (near `#F4F1EA`), high-contrast serif display, terracotta or clay accent (near `#D97757`) | The commonest "tasteful" default; `#D97757` is also Claude's own interface accent | Ground and accent from the anchors; if warm is right, find this subject's warm |
| Warm beige with brass, ochre or oxblood accents and espresso ink, for any "premium" brand | The premium-consumer default | Colour from the product itself: its metal, its leaf, its packaging |
| Near-black ground (`#0B0B0B`, `#111`) with one acid-green, lime or vermilion accent | The "bold" or "developer" default | Dark only when the subject lives in the dark; take the dark from the palette's hue |
| Broadsheet look: hairline rules, zero radius, dense newspaper columns | The "editorial" default | Editorial structure only for editorial content |
| SaaS card kit: content chopped into identical rounded cards, one radius, the same soft grey shadow (`rgba(0,0,0,.1)`), gradient washes | Containers as the only idea | Group with space and alignment; a card is an object |
| One word in the headline set in italic, serif, colour or bold | The most cited typographic tell | Emphasis through the whole line's size, weight or position, or none |
| A tracked ALL-CAPS label above every heading | Template chrome | A heading that names the thing needs no label; keep one or two labels a page that carry information |
| `01 / 02 / 03` markers | Numbering a non-sequence | Number only steps, timelines and rankings |
| Meta lines joined with middle dots (`A · B · C`); labels built as `WORD — fragment` | Chrome | A sentence, or a real list |
| A monospace face for small labels and data | Borrowed "technical" flavour | Mono only where code or data is the subject |
| An arrow appended to link and button text | Garnish | An arrow only where it means "goes elsewhere" |
| Grain or noise overlay; aurora gradients | Atmosphere by default | Texture only when an anchor is a physical material: once, low contrast |
| Bento grid as the feature section; logo or text marquee; giant display type cropped at the viewport edge | The 2024-25 agency defaults | Only when the content is genuinely unequal (bento) or the motion carries meaning |
| Faces of the moment: Space Grotesk, Geist, Satoshi, Cabinet Grotesk, Clash Display, Syne, Instrument Serif, Fraunces, Playfair Display, DM Sans, Plus Jakarta Sans, Manrope, Outfit | Picked because they are "not Inter" | `type-color.md` sections 1 and 2 |
| A hero made of a big number, a small label and a gradient accent | The default "impressive" hero | Only when the number is the story and is real |
| Violet or lavender as an AI product's brand colour | The AI-product default | A colour from what the product works on |

## 4. Product UI tells

| Tell | Why it reads as generated | Move |
|---|---|---|
| The dashboard template: sidebar, four KPI cards with green "+12.5%" chips, a line chart, "Recent transactions" | The same screen for every domain | Start from the decisions the screen supports; lead with exceptions and changes (`product-ui.md`) |
| Card soup: every widget boxed, cards inside cards | Boxes in place of hierarchy | Space, alignment and type first; a card only for an object |
| Untouched library defaults on a branded product (stock shadcn zinc and `rounded-md`, stock MUI blue) | No decision was made | Tune the theme once: radius, colour, type, density |
| Badges and pills on everything | Status noise | Badges only for status that changes |
| Gradient avatar circles with initials; a "Welcome back, John" banner with an emoji | Filler | Real photographs or neutral initials; give the space to the work |
| A spinner for every load | Happy path only | A skeleton shaped like the result; stale data stays visible while refreshing |
| Emoji or cartoon empty states with "No data yet!" | Mood instead of direction | Say what appears here and offer the action that fills it |
| A toast for every action; confirmation dialogs for reversible actions | Feedback detached from the thing | Inline feedback on the changed element; undo |
| Modals for everything | Interruption by default | Inline, drawer or page, by the size of the task |
| Charts in library default colours with heavy grids | Default rendering | The `dataviz` skill |
| Settings as one long form of identical inputs | No grouping by task | Group by task; explain the defaults |

## 5. Copy tells

A summary; the rules, registers and budget are in `copy.md`.

- **First generation:** stock words (elevate, unlock, seamless, supercharge, cutting-edge, robust, world-class; eleve, potencialize, revolucione, sem complicação); stock lines ("In today's fast-paced world", "Unlock the power of", "Ready to transform your X?"; "Leve seu negócio ao próximo nível", "Tudo em um só lugar"); residue (lorem ipsum, `[Company Name]`, markdown asterisks on the page); em dashes everywhere; exclamation marks in body copy.
- **Second generation:** one warm, wry, modest house voice for every client; invented specifics (a batch number, "6:12 a.m.", "38% fewer re-runs"); a strip of three figures under the hero; two-fragment headings ("Twelve rooms. Three ways to stay."); number-pair headings ("Four projects, four problems"); "not X but Y" and, once that is banned, "rather than", "instead of", "without the"; negation runs ("No forms. No waiting."); virtue words about ourselves (honest, calm, quiet, simply, thoughtful); a dry quip closing each paragraph; a sign-off line in the footer; the brand name's metaphor run through every section; the origin-story template ("In 2019, two friends..."); three polished testimonials, each with a number and a punchline; the default cast (Priya, Okafor, Marcus, Acme, Northwind, Fieldnote, Kestrel); eyebrow, claim, lede and three cards in every section; "Most popular" on the middle plan; "within two working days"; "Since 2015"; perfectly even cards; stock microcopy under a hand-tuned hero; process talk ("Below, you'll find").

## 6. Over-correction

Each rule breeds a habit. Expect it and counter it.

| Rule applied | Habit it breeds | Counter |
|---|---|---|
| Not Inter | Space Grotesk, Geist or Instrument Serif everywhere | Choose by vernacular; rotate across projects |
| Not purple | Acid green or teal on near-black; cream and terracotta | A palette from the anchors |
| No gradients | Flat beige and a serif | Colour and material from the subject |
| No centred hero | Every hero a 50/50 split | The composition the content needs; centred is right for a manifesto |
| No cards | A hairline-ruled broadsheet for everything | Cards where things are objects; space elsewhere |
| Add personality | Grain, a marquee and giant cropped type on every page | One signature, everything else quiet |
| No em dashes | Comma splices and nothing but full stops | Colons, brackets, semicolons where natural |
| No "not X but Y" | "Rather than", "instead of", "without the" | Count them together; state the positive |
| No hype words | Calm virtue words: quietly, honest, thoughtful | A fact in place of any adjective |
| Avoid threes | Everything in pairs | As many items as there are |
| Be specific | Invented numbers and anecdotes | The brief's facts, or a plainer line |
| Short sentences | A drumbeat of fragments | One longer sentence a section, where it explains |
| Vary section length | One huge and one tiny section on every page | Length follows the material |

## 7. Not tells

Leave these alone: perfect grammar; plain "is" and "has"; a list of three when there are three things; Title Case when it is the client's house style; the brand's own colours and faces, including Inter or purple; a centred layout for an invitation or a manifesto; a dark interface for a code editor or a cinema; a serif for a publisher; an FAQ when buyers really ask those questions; persuasion on a sales page, as long as it stands on facts.
