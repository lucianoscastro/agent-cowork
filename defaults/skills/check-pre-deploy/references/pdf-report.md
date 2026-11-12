# PDF Report and Artifacts

Save artifacts in `docs/security-audit/`:

- `findings.json` — structured source data with stack, scope, C01–C20 statuses, route ledger, findings, strengths, recommendations, pending decisions, manual actions, and limitations.
- `security-audit-report.html` — editable, reproducible report source with inline SVG charts.
- `security-audit-report.pdf` — final report in English (US).
- `generate-report.sh` — rerunnable wrapper that converts the HTML to PDF using an already installed renderer, such as Chromium, LibreOffice, or Pandoc.
- `security-audit-report.md` — complete fallback if no PDF renderer is available.

Do not create `*.py`, a Python virtual environment, or `requirements.txt` for scanning or rendering. If no HTML-to-PDF renderer is available, look for an equivalent installed tool. If none exists, export the complete report to `security-audit-report.md`, present it in the final response, and state that the PDF was not generated. Preserve the same structure in Markdown, including the summary, severity tables, recommendations, and complete issues; represent charts with text tables. Do not stop after providing HTML/JSON. Do not install tools without specific authorization.

Do not include real secrets in JSON, PDF, examples, metadata, or logs. Secret findings may include only the type/name, path, line, and sanitized snippet. The report contains sensitive information about the application's attack surface; tell the user to share it carefully.

## Required report contents

1. **Cover:** use the exact title `Security Audit Report — <project name>`, date, scope, and how the 20 checks map to the detected stack. The entire report must be in English (US).
2. **Executive summary:** counts by severity, a severity donut chart, and a bar chart by category. Use these colors: critical `#B91C1C`, high `#EA580C`, medium `#D97706`, low `#2563EB`, strength `#059669`. Do not invent findings or an aggregate score.
3. **Strengths and weaknesses:** verified controls with evidence and the main risks.
4. **Detailed findings by category:** severity, file:line, description, sanitized snippet, exploitability/impact, and recommended fix. Use color-coded severity chips.
5. **Coverage and limitations:** status and rationale for C01–C20; summary of the route ledger and unverified/out-of-scope items.
6. **Prioritized recommendations:** P1, P2, P3... ordered by risk and dependencies; call out manual actions and decisions owned by the product owner.
7. **Final section `GITHUB ISSUES`:** for each actionable finding, include the complete Markdown issue between `--- ISSUE n ---` and `--- END ISSUE n ---`. Each issue must include title `[Security] <short description>`, suggested labels `security` and the severity, problem/exploitability, sanitized evidence, impact, suggested fix, and a verifiable acceptance checklist. Group related trivial findings when that avoids duplicate issues. Issue text must be in English (US).

## Generation and verification

- Use A4, margins near 2 cm, and a header/footer with report title and page number. Keep text and tables legible; do not clip paths, line numbers, or acceptance criteria.
- Check which tools are already installed before choosing a pipeline. Do not install dependencies globally or use Python. Do not use the network to send findings or secrets.
- Keep the HTML static, populated from `findings.json`, with inline SVG charts. The wrapper should only call a local renderer already installed, with quoted paths; it must not scan the repository or read credentials.
- Generate the PDF from the HTML. Verify the page count and extracted text with local tools. Rasterize and inspect every page when possible, especially charts, chips, tables, and issue blocks; fix visual defects before delivery.
- If PDF generation or visual verification cannot be completed because no tool is available, do not claim the PDF is ready: provide the complete Markdown fallback, explain the limitation, and list the generated artifacts.
