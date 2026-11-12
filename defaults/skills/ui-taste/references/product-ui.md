# Product UI

Apps, dashboards, admin panels, internal tools and forms. Here "distinctive" means fitted to the job: the screen looks designed by someone who knows the work. Decoration is the tell; clarity is the craft. Default dials: variance 2 to 4, motion 1 to 3, density 5 to 8.

## 1. Start from the job

For each screen, write who uses it, how often, the one decision or action it supports, and what they need to see to make it. Order the screen by that, not by the data model. Frequent users earn density, shortcuts and bulk actions; occasional users earn guidance, defaults and explanations.

## 2. Layout

- Use the app's shell. One primary action per view, placed where the eye ends.
- Group with space and alignment first, then a subtle change of ground, then a hairline. A card only for an object (a project, a ticket, a shipment); never cards inside cards.
- **Dashboards** start from the questions users bring (Is anything wrong? What changed? What do I do next?). Lead with exceptions and changes, not four vanity figures. A figure shows its value, a comparison with an explicit period or target, and a way into the detail. Charts follow the `dataviz` skill.
- Master-detail, split panes and inline editing beat chains of modals. Drawers for context; modals only for decisions that must block.
- **Tables** for comparable records: text left, numbers right in tabular figures, units in the header, a sticky header, sorting and filtering where the column warrants, row actions on hover and focus plus a visible overflow menu, a density toggle when users differ.
- Long values truncate, with the full value available on hover and focus.

## 3. States

Generated UI ships the happy path only. Write each state:

| State | What it shows |
|---|---|
| Loading | A skeleton shaped like the result; on refresh, the previous data stays visible |
| Empty, first run | What will appear here, why it is useful, the action that fills it |
| Empty, no results | What was searched or filtered, and how to widen it |
| Error | What happened, what to do, a retry; the user's input preserved |
| Partial or stale | What is missing, or how old the data is |
| No permission | Why, and whom to ask |
| Disabled | Why, next to the control |
| Success | Inline, on the thing that changed; a toast only for background events |
| Destructive | Undo when reversible; for irreversible bulk actions, name the object and the count |

## 4. Forms

Label above the field; helper text where the rule is not obvious; validate on blur, and again on input once an error shows; the error under its field, linked with `aria-describedby`; never a placeholder as the label; the submit button stays enabled and lists what to fix; sensible defaults; long forms grouped by task, with a progress indicator only for genuinely multi-step flows.

## 5. The visual system in product UI

- **Colour:** a neutral interface; one accent for primary actions, selection and focus; semantic colours only for status, never the brand accent doubling as "success"; status also carried by an icon or a word, not by colour alone.
- **Type:** one family is usually right; three to five sizes; tabular figures in data.
- **Icons:** one set, one stroke; icon-only buttons have an accessible name and a tooltip.
- **Avatars:** real photographs or neutral initials, not rainbow gradients.
- **Empty illustrations:** optional and quiet; never emoji.

## 6. Component libraries

shadcn/ui, MUI, Ant Design, Chakra: keep their behaviour and accessibility, and change the look through the theme once (radius, colour, type, density), never with per-component overrides. The untouched default is a tell on a branded product; on an internal tool it is fine, and the effort belongs in hierarchy, states and copy.

## 7. Microcopy

The rules in `copy.md` section 6, plus: no "Welcome back" banner with an emoji taking the best space on the screen; the same name for an action everywhere (an "Archive" button produces "Archived"); numbers with units and periods ("R$ 12.400 in October", not "12.4k").
