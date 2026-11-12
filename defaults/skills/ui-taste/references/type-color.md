# Type and colour

## Contents

1. Find the face through the subject
2. Faces to avoid as defaults
3. Pools to widen the search
4. Setting type
5. Building the palette
6. Contrast and dark grounds
7. Palettes to avoid as defaults

## 1. Find the face through the subject

Type carries most of a page's personality, so choose it from the subject's own lettering: the signage, labels, packaging, documents, instruments and printing of its world. Work out what that lettering is like (condensed or wide, geometric or humanist, engineered or hand-made, which era), then find the closest available web face. The method matters more than the examples:

| Subject world | Its lettering | Look for | For example |
|---|---|---|---|
| Roads, transit, logistics | Highway and wayfinding signs, container stencils | Condensed or industrial grotesks; a stencil for one display moment | Overpass (Highway Gothic lineage), Barlow and Barlow Condensed (Californian signage), Big Shoulders, Saira, Big Shoulders Stencil |
| Aviation, instruments, hardware | Cockpit displays, panel labels | Engineered sans with distinct letterforms at small sizes | B612, IBM Plex Sans, Red Hat Text |
| Engineering, data, infrastructure | Spec sheets, technical drawings | Sober grotesk; a mono only where code or data is shown | IBM Plex Sans and Mono, Public Sans, Martian Mono |
| Health, government, accessibility-critical | Hyperlegible signage | Clear, open, unambiguous forms | Atkinson Hyperlegible Next, Public Sans, Source Sans 3 |
| Books, publishing, long reading | Book typography | Text serif with optical sizes | Newsreader, Literata, Source Serif 4, Spectral, Crimson Pro |
| Law, finance, institutions | Stationery, engraving | Restrained serif or a sober grotesk | Libre Caslon, Source Serif 4, Schibsted Grotesk, Hanken Grotesk |
| Food, bakeries, craft | Painted signs, packaging, stamps | Warm serif or slab; one characterful display, used once | Besley, Vollkorn, Zilla Slab, Young Serif, Gloock |
| Fashion, beauty, luxury | Magazine mastheads | High-contrast didone, sparingly | Bodoni Moda, Libre Bodoni, Imbue |
| Children, toys, play | Toy packaging, comics | Rounded or heavy display over a calm text face | Baloo 2, Gabarito, Bagel Fat One |
| Music, posters, sport | Gig posters, wood type, kit numbers | Condensed or wide display; width axes | Anybody, Archivo (width axis), Big Shoulders Display, Bricolage Grotesque |
| Games, retro computing | Bitmap screens | Pixel faces, for the subject itself only | Silkscreen, Pixelify Sans, Handjet, Sixtyfour |
| Heritage, history | Period printing | Revivals of the period | EB Garamond, IM Fell, Old Standard TT; blackletter (UnifrakturMaguntia) for one word at most |

The examples are Google Fonts. Libre foundries beyond Google (Velvetyne, Collletttivo, The League of Moveable Type, Fontshare beyond its three famous faces) widen the field; check the licence and self-host. If the project licenses commercial type, prefer it.

In product UI, legibility at 12 to 16px, tabular figures and a full weight range matter more than character. The system stack is a legitimate choice there (native, fast, nothing to load); it is a tell only on a brand surface.

## 2. Faces to avoid as defaults

These are not bad faces; they are what generated UI reaches for, so they signal "no decision". Use one only when the brand already uses it, the brief names it, or you can say why it suits this subject in particular.

- **First generation:** Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Raleway, Nunito, the bare system stack on a brand page.
- **Second generation:** Space Grotesk, Geist, Satoshi, Cabinet Grotesk, Clash Display, General Sans, Syne, Unbounded, Instrument Sans, Instrument Serif, Fraunces, Playfair Display, DM Sans, DM Serif Display, Plus Jakarta Sans, Manrope, Outfit, Urbanist, Sora, Cormorant.
- **Costume faces:** Orbitron and Michroma for "future", Press Start 2P and VT323 for "retro", Bebas Neue, Oswald and Anton for "bold", JetBrains Mono or Space Mono for "technical" labels.

## 3. Pools to widen the search

Alphabetical on purpose: no entry is the first choice. Use the pools to break out of the defaults, then let the subject decide. Do not reuse a face from an unrelated project in the same session.

- **Grotesk, exact:** Albert Sans, Familjen Grotesk, Golos Text, Hanken Grotesk, Host Grotesk, Mona Sans, Onest, Public Sans, Radio Canada Big, Red Hat Display and Text, Rethink Sans, Schibsted Grotesk, Wix Madefor.
- **Humanist, warm and legible:** Alegreya Sans, Atkinson Hyperlegible Next, Commissioner, Encode Sans, Fira Sans, Libre Franklin, Source Sans 3.
- **Geometric and rounded, friendly:** Baloo 2, Figtree, Gabarito, Geologica, Lexend.
- **Condensed and wide:** Anybody, Archivo, Barlow Condensed, Big Shoulders, Encode Sans Condensed, Saira.
- **Text serif:** Brygada 1918, Crimson Pro, Gelasio, Literata, Newsreader, Petrona, Piazzolla, Source Serif 4, Spectral.
- **Display serif, headlines only:** Bodoni Moda, Castoro, Gloock, Imbue, Libre Caslon Display, Young Serif.
- **Slab:** Aleo, Arvo, Bitter, Rokkitt, Zilla Slab.
- **Mono, when code or data is the subject:** Azeret Mono, Chivo Mono, DM Mono, Fragment Mono, Martian Mono, Red Hat Mono, Spline Sans Mono.
- **Characterful display, for the one signature:** Bagel Fat One, Big Shoulders Stencil, Bungee, Climate Crisis, Dela Gothic One, Shrikhand, Tilt Warp.

## 4. Setting type

- **Families:** one, or two that differ in structure (a serif and a grotesk, a condensed display and a text face); never two near-twins, never three. Each has a fixed job.
- **Scale:** a modular ratio chosen by density: 1.125 to 1.2 for dense product UI, 1.25 to 1.333 for content sites, 1.414 to 1.618 for expressive pages. Steps live in tokens; `clamp()` for display sizes.
- **Measure:** 45 to 75 characters for body text (`max-width` in `ch`); a serif may run a little longer than a sans.
- **Leading:** body 1.45 to 1.65 (a serif body a little more than a sans); display 0.95 to 1.15, with room for descenders when it is italic.
- **Tracking:** tighten large display (-1% to -4% from about 40px); never loosen body text; letter-space capitals only where capitals are truly needed.
- **Weights:** two or three in total; let size and space carry hierarchy instead of bold-and-big on every heading; no light weights under 20px.
- **Case:** sentence case for headings, buttons and labels (in Portuguese too, where Title Case is an anglicism).
- **Numerals:** tabular (`font-variant-numeric: tabular-nums`) in tables, prices compared in columns and timers; old-style figures in running serif text when the face has them.
- **Emphasis:** never one decorated word inside a headline. If a phrase carries the message, give the whole line the weight.
- **Type as image:** when type is the signature, use the face's axes (width, optical size, weight), scale contrast and a line break chosen by meaning, so the headline is the design rather than a label on it.
- **Loading:** woff2, subset, `font-display: swap`, a fallback tuned with `size-adjust` and `ascent-override` to avoid layout shift, at most four files.

## 5. Building the palette

1. **Sample the anchors.** List colours that exist in the subject's world: its materials, signage, packaging, the product, its photography. Name tokens after them (`--kiln-ash`, `--waybill-blue`), then map them to roles.
2. **Roles:** ground; surface (one step off the ground); ink (body text); muted (secondary text, still 4.5:1); line (hairlines, about 10 to 15% of the ink); accent (one job: the primary action, focus and links); accent-ink (text on the accent). Product UI adds success, warning, danger and info, kept distinct from the accent.
3. **Proportion:** the interface stays mostly neutral and colour comes from the content: photographs, the product, data. The accent covers a small share of any screen. If colour itself is the signature (a full-bleed field in the brand colour), everything else goes quieter.
4. **Build in OKLCH.** Neutrals are low-chroma versions of the palette's hue (chroma 0.005 to 0.02), stepped by lightness; one temperature of grey across the page, never warm and cool mixed. Check the accent on the ground and on any dark surface you will use.
5. **No raw framework palette as the brand:** Tailwind's `indigo-500`, `blue-500`, `emerald-500` or `slate-900` used unchanged reads as "no decision". Tune them, or start from the anchors.
6. **Shadows**, when something truly floats, are tinted toward the ground's hue, never neutral black at 10%.

Worked examples of the method, not palettes to reuse: freight, waybill blue and safety orange on concrete grey; a ceramics studio, celadon glaze, iron red and raw clay; a law firm, ink blue-black on paper with a seal red used once; a football club, the kit's own colours at their real proportions.

## 6. Contrast and dark grounds

- Compute contrast, never eyeball it: body text 4.5:1 or more (aim for 7:1 in long reading), large text 3:1, UI boundaries and the focus ring 3:1. Muted text and text on the accent are where it usually fails.
- A dark ground is a subject decision (night, cinema, music, tools used in dark rooms), not a premium shortcut. Take the dark from the palette's hue (OKLCH lightness 0.15 to 0.22, small chroma) instead of the universal `#0B0B0B` or `#111`; raise surfaces by lightness instead of shadows; lower the accent's chroma a little; use an off-white ink rather than pure white.
- Dark mode in product UI is a second token set designed on purpose, not an inversion.

## 7. Palettes to avoid as defaults

Each is legitimate when the brand owns it. As a reflex, it is a tell:

- Indigo, violet and purple gradients; lavender tints.
- Cream (`#F4F1EA` to `#FAF7F1`) with terracotta (`#D97757`) and a serif.
- Beige with brass, ochre or oxblood and espresso ink, for anything "premium".
- Near-black with one acid green, lime or vermilion.
- `slate-900` with a cyan or emerald glow, for anything "developer".
- Pastel mesh gradients on white.
- Black, white and one red, for anything "editorial".
