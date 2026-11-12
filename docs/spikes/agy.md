# Spike: Antigravity CLI (`agy`) as a provider

Date: 2026-11-09 · CLI version tested: 1.5.3 · Verdict: **viable with an API key; account login only for business accounts, experimental**

## What was tested

| Check | Result |
| --- | --- |
| Install on Linux x64 | ✅ The official installer downloads a per-platform manifest and verifies the binary's SHA-512. `--dir <path>` sets the target. Our Dockerfile can fetch the same manifest and verify the hash, with no `curl \| bash`. |
| Binary | Single glibc ELF, **236 MB** (adds about 20% to the image). |
| Runs in our hardened Wolfi image | ✅ `--version` works with a read-only root filesystem, no capabilities and `no-new-privileges`. |
| Headless JSON with piped stdout | ✅ `agy -p … --output-format json` writes a JSON envelope to stdout on Linux. The empty-stdout bug reported for Windows does not reproduce. |
| Structured output | Documented: `--json-schema` returns the parsed value in `structured_output`. Not yet run against a real model. |
| **API key auth** | ✅ Mechanism works: `GEMINI_API_KEY` plus `{"modelProvider":"gemini"}` in `~/.gemini/antigravity-cli/settings.json` reaches the Gemini API (a bogus key returns `API_KEY_INVALID`). A real key is still needed to finish the check. |
| **Account auth** | ⚠️ Partially. Without credentials, a headless run prints a Google OAuth URL on stderr and waits for the authorization code, so the platform can drive the flow (show the URL, paste the code back). Not yet validated: where the token is stored when there is no OS keyring (as in a container), and whether later headless runs reuse it. |
| State on disk | `~/.gemini/` (conversations, cache, logs). In our container HOME is a tmpfs, so login state must be persisted under `/data`. |
| Tool control | Documented: approval-gated tools are soft-denied in headless runs. Allow rules go in `permissions.allow` in `settings.json` (for example `command(regex:pnpm (build\|test))`). `--sandbox` and `--mode` are available. |

## Terms of use

From the Antigravity Additional Terms (clause 6) and the Google Terms of Service:

- **Personal Google accounts (Free, Pro, Ultra):** using the service "in connection with products not provided by us", or accessing it through "third party software, tools, or services", is a breach and may lead to suspension. The terms give "using OpenClaw with Antigravity OAuth" as an example. Whether a self-hosted orchestrator counts is not stated. **Treat it as not allowed.**
- **Gemini Enterprise, Workspace, or an API key in Gemini for business:** governed by the terms the organization's administrator accepted.
- Interactions may be reviewed by Google unless opted out. Check that before sending private code.

## Decision for the product

1. Support `agy` with **API key** as the primary method.
2. Offer **account login only for business accounts**. In the UI, show a warning that personal accounts are not permitted by Google's terms for this use.
3. Ship the provider as **experimental** until a real key and a business login pass the checks below.
4. Persist `~/.gemini` under `/data/providers/agy`, and allow-list tools through `settings.json` generated per run.

## Remaining checks (need real credentials)

- [ ] API key: a run with `--json-schema` returns valid `structured_output`; usage is reported.
- [ ] Business account login driven from the UI: URL shown, code pasted, the token survives a container restart, and headless runs reuse it.
- [ ] Write mode: file edits and allow-listed commands work, and other commands are denied.
