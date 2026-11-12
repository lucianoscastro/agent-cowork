# Accessibility check catalog (WCAG 2.2 AA)

| ID | Check | WCAG | Base severity | Evidence to review |
|---|---|---|---:|---|
| A11Y01 | Text alternatives | 1.1.1 | High | `<img>` without `alt`, informative icons and SVGs without a name, decorative images not hidden (`alt=""`, `aria-hidden`). |
| A11Y02 | Names of controls | 4.1.2 | High | Icon-only buttons and links without `aria-label` or visible text; generic names ("click here", "button"). |
| A11Y03 | Form labels | 1.3.1, 3.3.2 | High | Inputs, selects and checkboxes without an associated `<label>`, `aria-label` or `aria-labelledby`; placeholder used as the only label. |
| A11Y04 | Semantic interactive elements | 2.1.1, 4.1.2 | Critical | `onClick` on `div`/`span` without `role`, `tabIndex` and key handlers; links used as buttons and buttons as links. |
| A11Y05 | Keyboard access and traps | 2.1.1, 2.1.2 | Critical | Hover-only menus, drag-only interactions, custom widgets without arrow-key support, focus traps outside modals. |
| A11Y06 | Visible focus | 2.4.7, 2.4.11 | High | `outline: none` or `:focus { outline: 0 }` without a replacement focus style; focus hidden behind sticky headers. |
| A11Y07 | Dialogs and overlays | 2.4.3, 4.1.2 | High | Modals without `role="dialog"`/`aria-modal`, no focus moved in and returned on close, no Escape to close, background still reachable. |
| A11Y08 | Headings and landmarks | 1.3.1, 2.4.6 | Medium | Pages without an `h1`, skipped heading levels, missing `main`/`nav` landmarks, no skip link on long navigation. |
| A11Y09 | Color contrast and color-only meaning | 1.4.3, 1.4.11, 1.4.1 | Medium | Text and UI tokens below 4.5:1 (text) or 3:1 (large text, controls); status shown only by color. Compute from tokens when possible. |
| A11Y10 | Error identification and announcements | 3.3.1, 3.3.3, 4.1.3 | High | Validation errors not tied to fields (`aria-describedby`, `aria-invalid`), errors and toasts not announced (`role="alert"`, `aria-live`). |
| A11Y11 | Tables and lists | 1.3.1 | Medium | Data tables without headers (`th`, `scope`), layout built from divs that read as unrelated text. |
| A11Y12 | Page title and language | 2.4.2, 3.1.1 | Low | Route changes without a document title update; missing `lang` on `<html>`. |
| A11Y13 | Motion and timing | 2.2.2, 2.3.3 | Medium | Animations without `prefers-reduced-motion` handling, auto-advancing carousels without pause, session timeouts without warning. |
| A11Y14 | Zoom and reflow | 1.4.4, 1.4.10 | Medium | Fixed pixel font sizes and widths that break at 200% zoom or 320 px width; `user-scalable=no`. |

## Stack notes

- **React**: `jsx-a11y` lint rules (present or absent), Testing Library queries by role as indirect evidence, `aria-*` props passed to library components (Ant Design `Modal`, `Table`, `Form.Item` labels).
