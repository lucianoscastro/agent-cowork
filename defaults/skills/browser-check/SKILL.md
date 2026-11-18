---
name: browser-check
description: "Checks a UI change in a real browser before it ships: starts the app from the working checkout, waits until it answers, looks at the changed screens with the Playwright browser tools (snapshot first, then act), reads the console and failed requests, tries a narrow viewport and the keyboard, saves screenshots as evidence, and stops what it started. Use when a change alters what a person sees and the `playwright` browser tools are available. Not for writing end-to-end tests that are committed: those follow the repository's own test setup and tdd-workflow."
license: "Apache-2.0 (adapted from Anthropic's webapp-testing skill)"
metadata:
  origin: "adapted"
---

# Browser Check

The must-pass commands prove the code builds and its tests pass; they never look at the screen. This check does, once, before the change ships: the screen the card asks for renders, the flow works with a mouse and a keyboard, and the console stays clean. It adds evidence; it never replaces a test.

Skip it when nothing a person sees changed (a back-end, data or build change).

## 1. Start the app

- Find how the repository runs locally: its `AGENTS.md`, `CLAUDE.md` or README, then the `package.json` scripts (`dev`, `start`, `preview`). Run the front end you changed, from your checkout.
- Dependencies are installed by the must-pass commands; install them the same way if they are not.
- Start it in the background on a free port, its output in a log outside the checkout, and keep its process id:

  ```bash
  port=$((5100 + RANDOM % 800)); log=$(mktemp)
  pnpm dev --port "$port" --strictPort > "$log" 2>&1 & echo $!
  ```

  The flag differs per tool: Vite `--port`, Next.js `-p`, Create React App `PORT=`.
- Wait until it answers, then read the log if it never does:

  ```bash
  for i in $(seq 90); do curl -sf "http://localhost:$port" > /dev/null && break; sleep 1; done
  ```

- No dev server: build, then serve the output folder (`pnpm preview`, or `python3 -m http.server "$port"` inside it).
- The screen needs a back end: start it too when it runs locally without secrets. When it needs a database, credentials or a service this run does not have, check what renders without it (the mocks or the component stories the repository already has) and say what could not be checked. Never point the app at a real environment, and never invent credentials.

## 2. Look, then act

1. `browser_navigate` to the page, then `browser_wait_for` the text that shows it rendered. A dynamic app paints after its first response: inspecting before that is the common mistake.
2. `browser_snapshot`: the accessibility tree names every element with a ref to act on. Use those refs instead of guessing selectors.
3. Walk the changed flow: `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_press_key`. Take a snapshot again after every step that changes the page.
4. Check:
   - what the card or the spec's criteria ask for is on the screen, with the concrete values;
   - the other states of the changed screen: empty, loading, error, long text;
   - `browser_console_messages`: no error the change brought;
   - `browser_network_requests`: no failed call to the app's own API.
5. `browser_take_screenshot` of each changed screen, with a name that says what it shows (`orders-export-button.png`).
6. `browser_resize` to 390x844 and take a screenshot of the changed screen again, then go back to 1440x900.
7. Keyboard: Tab through the changed controls. Focus is visible and the order follows the screen.

## 3. Fix and look again

- A problem the change caused: fix the code, let the dev server reload (or restart it), and repeat the same steps.
- A problem the change did not cause: leave it, and list it in your summary as a follow-up.

## 4. Stop and report

- Stop every process you started (`kill <pid>`, and `pkill -P <pid>` for its children) and close the browser (`browser_close`). The platform also stops what is left when the call ends.
- In the summary, under **How to test**: the steps you ran, what you saw, and the screenshot names. Say what you could not check, and why.

## Edges

- The browser reaches only `localhost` and `127.0.0.1`. Never change the app's configuration to reach a remote environment, and never turn a security setting off to make it run.
- No secrets, real accounts or personal data in forms or screenshots: use test data.
- Screenshots and logs stay outside the checkout (the browser tools save them in the run's log). Never add them to the repository.
- About 10 minutes for the whole check. A dev server that still does not start after two attempts is reported, not fought.
- Never change tests, build, lint or CI configuration to get the app running.

Adapted from Anthropic's `webapp-testing` skill (Apache License 2.0): the server lifecycle, the wait-before-inspecting rule and the look-then-act pattern, rewritten for the Playwright MCP tools instead of Python scripts. The steps on states, viewport, keyboard, evidence and reporting are additions.
