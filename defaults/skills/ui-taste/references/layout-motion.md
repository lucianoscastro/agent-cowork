# Layout, shape and motion

## Contents

1. Compose from content
2. The hero
3. Section rhythm
4. Grid, edges and responsive
5. Shape and depth
6. Imagery and icons
7. Motion: three layers
8. Motion rules
9. Implementation

## 1. Compose from content

- List the real material first (copy, photographs, screenshots, data, facts) and compose around what exists. Order sections by the reader's questions: what is it, is it for me, how does it work, what does it cost, can I trust it, what do I do now.
- Sketch two or three first-screen compositions as ASCII wireframes and compare them against the brief before choosing:

  ```text
  A  type as image          B  product in use          C  index
  +----------------------+  +----------------------+  +----------------------+
  | name      nav  [Act] |  | name      nav  [Act] |  | name           nav   |
  |                      |  | Headline   +-------+ |  | Rooms ............   |
  | HEADLINE SET LARGE   |  | sub-line   | live  | |  | Kitchen ..........   |
  | ACROSS THE GRID      |  | [Action]   |  UI   | |  | Garden ...........   |
  | sub-line    [Action] |  |            +-------+ |  | Book a night  [Act]  |
  +----------------------+  +----------------------+  +----------------------+
  ```

- Decide alignment on purpose: left-aligned for anything people read; centred for short statements, invitations and manifestos; justified only with hyphenation in long-form serif.

## 2. The hero

Open with the most characteristic thing in the subject's world, in the form that suits it best:

- **Type as image:** the headline set large as the visual; statements, studios, launches.
- **The product in use:** the actual interface, as live HTML, doing the thing it does (a code-review tool shows a diff with its Accept button), not a generic dashboard or fragments floating on panels.
- **The photograph:** the place, the object, the people; real, or a stand-in listed as one in the report.
- **The interactive moment:** a demo, a calculator, a configurator, a search that answers.
- **The information:** a map, a timetable, a live figure, a table, when the information is the product.

The hero fits the first viewport with its main action visible; the headline runs two or three lines at most on desktop and the sub-line about twenty words; one primary action and at most one secondary. Logo walls, pricing teasers and bullet lists go below it. The default to avoid: a pill badge, gradient headline, sub-line, two buttons and a screenshot in a tilted frame; and the big-number-small-label-gradient hero unless the number is the story.

## 3. Section rhythm

- One idea per section, each with a layout family chosen for its content: full-bleed image; split with deliberate spans (5/7 or 4/8, not always 6/6); list or index rows; table; single statement; gallery with varied sizes; long-form column with notes in the margin; timeline or steps (only for sequences); a quote set large; a map; a comparison table; an FAQ as a plain question-and-answer list.
- A page of six or more sections uses at least four families, never the same family twice in a row, and at most two image-and-text zigzags in a row.
- Vary density: a dense section beside an airy one makes rhythm; identical padding everywhere flattens it.
- Separate sections with a change of ground or with space, not with borders plus shadows. One contrasting band a page is usually enough.
- A short block joins its neighbour instead of floating alone in a tall padded section.
- Bento only when the items are genuinely unequal and every cell has content: as many cells as items, never a blank filler tile.
- Nothing extra floats on the page (chat bubble, newsletter modal, back-to-top square, badge) unless the brief asks.

## 4. Grid, edges and responsive

- One container width and one column grid with a fixed gutter; everything sits on its lines, and left and right content edges match. A single deliberate breakout (a full-bleed image, a headline crossing the grid) is a move; scattered misalignment is not.
- Spacing comes from one scale (4- or 8-based) held in tokens, and vertical rhythm from the same scale.
- Compose the phone layout on purpose: text before its picture, display type resized with `clamp()`, the main action within reach, a full-screen menu, 44px targets, no sideways scroll at 320px. Desktop navigation fits on one line. Use `svh` for full-height sections.
- Check 1440, 1024, 768 and 390 (and 320 for overflow).

## 5. Shape and depth

- **Cards** are for objects the user acts on or compares (a product, an article, a plan, a ticket). Grouped text needs space, alignment, a rule or a list, not a box. Two levels at most: a card holds media; a card never holds cards.
- **Radius** follows size and role: small controls small, large surfaces larger, a nested radius equal to the outer radius minus the padding. One rule per page: sharp for precise tools and finance, soft by default, round for consumer and playful products, square where the anchor is print or architecture.
- **Borders:** hairlines at about 8 to 15% of the ink, only where structure needs them.
- **Shadows** only for things that float (menus, popovers, dialogs, dragged items), tinted toward the ground; none at rest on cards, though a clickable card may gain a soft one on hover.
- **Blur and glass** only for overlays above moving content, and subtle; never as a card style.
- **Texture** only when an anchor is a physical material: one texture, low contrast, never under text.

## 6. Imagery and icons

- Real photographs and screenshots beat illustrations and 3D blobs. A stand-in is listed in the report as a stand-in and is never shown with another company's name or logo.
- No caption that explains or apologises for a picture; licence credits go in one footer line.
- Avoid the stock genres: the diverse team laughing at a laptop, the handshake, the abstract network of glowing dots.
- One icon set, one stroke weight, sized to the text beside it. Real brand logos keep their own colours and are never redrawn.

## 7. Motion: three layers, nothing else

1. **Entrance (optional):** one orchestrated sequence when the first screen loads, about 0.6 to 1.1 s in all (the headline by lines, then the sub-line and actions, the picture settling). Once a visit, never again on scroll.
2. **One signature moment (optional):** a single interaction or scroll-scrubbed sequence, inside its own section, that shows something true about the subject: a process, a transformation, a before and after.
3. **Feedback (required):** every interactive element answers: hover (fine pointers only), press, focus-visible, open and close, success and error. Hover 120 to 200 ms, press 80 to 120 ms, open 180 to 240 ms, exit faster than entry.

Write each motion in the direction sheet with its purpose in a few words; a motion without a purpose is cut. The page must read completely with all motion off.

## 8. Motion rules

- Animate transform and opacity (clip-path and filter sparingly), never width, height, top or margin.
- Ease-out for entering, ease-in for leaving; no overshoot on interface chrome unless the brand is playful.
- Avoid by default: a fade-up on every section or card as it scrolls in; parallax on text; scroll-jacking and smooth-scroll libraries; auto-advancing carousels and timed tabs; tilting cards, magnetic buttons, cursor-following blobs and glows; floating or pulsing decoration; typewriter headlines; numbers counting up on view; logo marquees; scrambled or glitching text; animated gradients.
- Under `prefers-reduced-motion: reduce`, the entrance and the moment show their finished state, only colour and opacity transitions remain, and nothing stays hidden.
- Anything that moves for more than five seconds gets a pause control.

## 9. Implementation

- CSS first: transitions, `@keyframes`, the View Transitions API for state and page changes, and scroll-driven animations (`animation-timeline: view()`) scoped to the one moment, with an `@supports` fallback.
- In React, use the animation library the project already has; do not add one for a hover.
- Gate hover-only effects behind `@media (hover: hover) and (pointer: fine)` and mirror them on `:focus-visible`.
