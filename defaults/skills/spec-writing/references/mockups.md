# Prototypes

Only when the run's prompt says people approve the documents on the card before the Developer builds, and the card changes what a person sees, or when it asks for a discovery ([discovery.md](discovery.md)). A clickable prototype lets them react to the screens before any code exists: a misunderstanding that hides for days in prose shows in seconds on a screen.

## What to make

- **One self-contained HTML file per flow**, named `mockup-<flow>.html` (`mockup-orders-export.html`), returned in `files` with the documents. One is usual; a card that changes many flows is often several cards (one card, one spec).
- **Navigable.** The screens of the flow in one file, switched by the controls the criteria name: the button opens the dialog, Save shows the success state. A small "States" bar shows the empty, loading, error and long-content states the criteria cover.
- **It looks like the product.** Read the repository's tokens, styles and the components of the screen it changes, and copy their colors, fonts, spacing and radius into inline CSS. When the change adds to an existing screen, draw that screen as it is today with the new part in place.
- **The criteria, nothing more.** Every control, field, label and state on screen comes from a criterion, with its concrete value (the 31-day limit, the exact error text). When the prototype needs something no criterion has, the criteria have a gap: add the criterion, or ask.
- **Fictional data** ("Acme Shop", "order 1042"): never names, emails or values from the card, the code or a database.
- **A thin banner at the top**, in the prompt's language: "Prototype - illustrative only; the criteria in spec.md decide."
- **Named in `spec.md`**, under `## Sources`, with the criteria it shows: `- Prototype: mockup-orders-export.html (AC1-AC5)`.

## Limits

- One whole HTML document that starts with `<!doctype html>`, with inline CSS and JavaScript and no other file: no CDN, font, image or script address, no `fetch`, no form that submits, no link out of the file. The platform adds a policy that blocks the network, and sends back a prototype that names an `http://` or `https://` address, even encoded, or does not start with `<!doctype html>`.
- Plain HTML, CSS and JavaScript: no framework and no build step. Under 150 KB.
- Real buttons and labels, visible focus, usable with the keyboard.
- It is not the implementation. The Developer builds with the repository's own components and tokens, following the prototype's content and flow, never its markup.

## In a discovery

The prototype shows the proposed direction, not criteria: the screens of `## Screens` in `discovery.md`, drawn as they would become.

- **One file per area** of the product, its screens linked by the navigation the direction proposes, so people walk the product the way they will use it.
- **The new look.** The colors, type, spacing and radius the direction proposes, as CSS variables at the top of the file, so the child cards can lift them. When the direction keeps today's look, copy the repository's tokens instead.
- **The states that decide the direction** (an empty list, an error, a long table), not every state: the child cards' criteria cover the rest.
- **Fictional data, and the banner**: "Prototype - illustrative only; discovery.md decides." Named under `## Sources` of `discovery.md` with the screens it shows.
- **The limits above** hold: one whole offline document, plain HTML, CSS and JavaScript, under 150 KB, usable with the keyboard.

A card created under an approved discovery already has its screens drawn there: a prototype of that card covers only what it changes beyond the discovery's, or there is none.

## New versions

A new version updates the prototype with the documents: a change people ask for on a screen lands in the criteria first, then in the prototype. A version whose card no longer changes a screen drops it. An unchanged prototype is returned byte for byte, so it is not attached again.

The prototype idea is adapted from the visual companion of the `brainstorming` skill in Jesse Vincent's [superpowers](https://github.com/obra/superpowers) (MIT License), turned into an attachment people open from the card.
