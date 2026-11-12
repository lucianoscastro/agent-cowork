# Copy

Words are design content: they make a page as templated as its layout does, and they are where generated UI is easiest to spot. Bring the same intent to them as to spacing and colour.

## Contents

1. Rules
2. Integrity
3. Voice: pick a register
4. Device budget
5. Words and lines that read as generated (EN, PT-BR)
6. Microcopy

## 1. Rules

- The headline names the thing and who it is for (or the place): a plain claim that would be false for a competitor, never a slogan that fits any company.
- One hard fact on the first screen: a price, a place, a time, a real capability, a figure from the brief.
- Every heading holds a noun and says what the section holds.
- Buttons are a verb and an object ("Book a table", "Export CSV", "Agendar visita"); an action keeps its name through the flow ("Publish" produces "Published"); one label per intent across the page (not "Get started", "Sign up" and "Try free" for the same thing).
- Sentence case, active voice, plain verbs; "you" for what the user gets.
- Name things the way users know them, not the way the system is built: "notifications", not "webhook config".
- Spend words where the brief knows most; a section with nothing true to say is cut, not padded. Real pages are uneven; generated pages are perfectly even.

## 2. Integrity

- Never invent testimonials, quotes, client logos, metrics, awards, founding years, team members, addresses or phone numbers. Use the brief's; otherwise leave the section out or write a plainer line.
- Placeholder content that must exist is obvious to the developer (a code comment, a line in the report) and is never dressed as real.
- Names in mock data fit the market and generation (Brazilian names for a Brazilian product), never the default cast.
- The page never talks about itself or how it was built ("This section shows", "Below, you'll find").

## 3. Voice: pick a register

The model's own voice is out unless asked for: warm, wry, modest, a little literary, ending paragraphs on a deadpan twist and calling itself honest. Readers now recognise it. Copy the client's voice when there is a sample; otherwise pick one register by the audience, the price and the client's real character, and borrow at most one move from a second.

| Register | Fits |
|---|---|
| Facts only | Agencies, finance, architecture, portfolios |
| Technical and dry, with proof | Developer tools, infrastructure, AI products |
| Founder's or teacher's letter | Small-business software, courses |
| Self-aware and playful | Drinks, snacks, consumer apps (never in prices or errors) |
| Literary and formal | Skincare, culture, publishing |
| Proper nouns and restraint | Luxury hotels, architecture |
| Sensory, second person, present tense | Cafes, food, fitness, events |
| Historical scene | Heritage brands with a real history |
| Plain-spoken activist | Causes, challenger brands |
| Refusal and narrowness | Repair shops, specialists who say what they do not do |
| The product as hero | Hardware, apps: specs instead of adjectives |
| Hurried and conversational | Portfolios, small guesthouses |

Test it: picture the voice on nine businesses in other trades. If it suits them, push it further toward this client. Voice holds while tone moves: most voice in the hero and the story, plain language in prices, forms and errors, where readers are anxious.

## 4. Device budget

None of these is banned; each works once. Used by default, they become the tell.

| Device | Per page |
|---|---|
| Two-fragment heading "X. Y." | 1 |
| Number-pair heading "Four X, one Y" | 0 to 1 |
| "Not X but Y", "rather than", "instead of", "isn't just" (counted together) | 2 |
| Negation run "No X. No Y." | 1 |
| Dry closing line on a paragraph | 2, never in a row |
| Pun on the brand name | 1, never the headline |
| Eyebrow labels | 1 to 2, only when they carry information |
| Step numbers | only for real sequences |
| Lists of three | when there are three things |
| Testimonials, figures, "Since [year]", response-time promises | only the brief's |
| Exclamation marks in body copy | 0 |
| Emoji in interface copy | 0, unless the brand writes that way |

## 5. Words and lines that read as generated

Each stands in for a fact: "seamless" for the setup steps, "robust" for the failure case, "powerful" for the figure. Replace it with the fact, never with a synonym. A literal use stays (a climbing harness, a seamless knit, an actual journey), and so does the client's own name.

- **English words:** delve, tapestry, testament, realm, embark, beacon, multifaceted, paradigm, myriad, plethora, meticulous, intricate, elevate, unlock, unleash, empower, harness, supercharge, seamless, effortless, cutting-edge, revolutionary, transformative, holistic, next-level, world-class, best-in-class, game-changer, state-of-the-art, synergy, leverage (as a verb), reimagine, robust, powerful, nestled, unparalleled, curated, crafted, journey, ecosystem, landscape (as a metaphor).
- **English lines:** "In today's fast-paced world", "Unlock the power of", "The future of X is here", "Say goodbye to", "Whether you're A or B", "Join thousands of", "Trusted by teams worldwide", "Ready to transform your X?", "Look no further", "X made simple", "at your fingertips", "in just a few clicks", "It's not just X, it's Y", "Built for the way you work".
- **Virtue words about ourselves:** honest, calm, quiet, actually, genuinely, truly, simply, thoughtful, carefully, intentional.
- **Portuguese words:** eleve, desbloqueie, potencialize, impulsione, alavanque, revolucione, transforme, mergulhe, inovador, de ponta, robusto, poderoso, ecossistema, jornada (except for travel or working hours), experiência única, solução completa.
- **Portuguese lines:** "Leve seu negócio ao próximo nível", "Tudo em um só lugar", "Sem complicação", "De forma simples e rápida", "Feito para você", "Pronto para começar?", "Não é apenas X, é Y", "O futuro de X chegou", "Diga adeus a", "Seja você A ou B", "Junte-se a milhares", "Com apenas alguns cliques", "Clique aqui".
- **Portuguese habits:** Title Case in headings (an anglicism; Portuguese headings use sentence case); "Saiba mais" on every link; English loanwords where a plain Portuguese word exists; em dashes (travessões) as a tic.

## 6. Microcopy

The place a voice is most welcome, and the place generated UI leaves stock text.

- **Errors** say what happened and how to fix it, in the interface's voice, next to the field: no apology, no "Oops", no "Something went wrong" without a next step.
- **Empty states** say what will appear here and offer the action that fills it; a first-run state differs from a no-results state.
- **Confirmations** use the past tense of the action ("Invoice sent", "Pedido enviado").
- **Loading and progress** name what is happening when it takes more than a moment ("Importing 1,240 rows").
- **Destructive actions** name the object ("Delete 3 invoices"), not "Are you sure?".
