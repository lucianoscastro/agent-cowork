# Runtime base: Debian trixie with Node (glibc like the Ubuntu CI runners; Debian security ships Chromium
# fixes promptly and Playwright supports it). Pinned by digest; the build also applies pending security
# updates, and the daily CVE scan (.github/workflows/cve.yml) says when a rebuild is due.
ARG RUNTIME_IMAGE=node:26-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

# --- tools: downloads only; nothing from this stage ships except the copied artifacts.
# The agent CLIs are pinned: a new release changes how agents behave, so bumping one is a deliberate
# change, tested before it ships (see README → Image). pnpm follows its newest release on purpose, and OS
# packages below stay on their major to keep receiving security fixes.
FROM node:current-trixie-slim AS tools
ARG CLAUDE_CODE_VERSION=2.1.306
ARG CODEX_VERSION=0.167.0
# Newest release on every build; pin with --build-arg PNPM_VERSION=x.y.z.
ARG PNPM_VERSION=latest
# agy publishes each build at its own URL with a SHA-512 (its installer only fetches the newest).
ARG AGY_BUILD=1.5.3-6604829099950080
ARG AGY_SHA512_AMD64=e363e1b17daaac2589f18e6973429c039fd5a5e5c15e9c0852fa349836f3992b10fe84732bc8d8c8208e149f0304f15aba9dec696d12efeed03917492c0580eb
ARG AGY_SHA512_ARM64=c2fac818b3c1bb224079df03a714ccba99728b6a3a41d86d247ab2feb8582a43840c5032f1c2b75e72667623d5503e7ffda2712c4f37b6ee19f99c3fcfb25bae
# Browser tools for the Sentinel agent's models (reproducing failures, exploring an environment).
ARG PLAYWRIGHT_MCP_VERSION=0.0.84
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
# Signing keys of the apt repositories the runtime installs .NET and gh from.
RUN mkdir -p /opt/apt-keys \
 && curl -fsSL https://packages.microsoft.com/keys/microsoft-2025.asc -o /opt/apt-keys/microsoft.asc \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /opt/apt-keys/githubcli.gpg
RUN npm install -g --prefix /opt/npm pnpm@${PNPM_VERSION} @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @playwright/mcp@${PLAYWRIGHT_MCP_VERSION}
# Codex: the native binary, its tool host (code-mode-host runs file reads and commands), ripgrep and bubblewrap.
# Voice assets are left out.
RUN case "$(dpkg --print-architecture)" in amd64) a=x64; t=x86_64 ;; arm64) a=arm64; t=aarch64 ;; esac \
 && cd /tmp && npm pack --silent "@openai/codex@${CODEX_VERSION}-linux-${a}" && tar xzf openai-codex-*.tgz \
 && v="package/vendor/${t}-unknown-linux-musl" && mkdir -p /opt/codex/bin /opt/codex/codex-path /opt/codex/codex-resources \
 && cp "$v/codex-package.json" /opt/codex/ && cp "$v/bin/codex" "$v/bin/codex-code-mode-host" /opt/codex/bin/ \
 && cp "$v/codex-path/rg" /opt/codex/codex-path/ && cp "$v/codex-resources/bwrap" /opt/codex/codex-resources/
# Antigravity CLI: the pinned build, checked against its published SHA-512.
RUN case "$(dpkg --print-architecture)" in \
      amd64) dir=linux-x64; file=cli_linux_x64; sum=${AGY_SHA512_AMD64} ;; \
      arm64) dir=linux-arm; file=cli_linux_arm64; sum=${AGY_SHA512_ARM64} ;; esac \
 && curl -fsSL "https://storage.googleapis.com/antigravity-public/antigravity-cli/${AGY_BUILD}/${dir}/${file}.tar.gz" -o /tmp/agy.tgz \
 && echo "${sum}  /tmp/agy.tgz" | sha512sum -c - \
 && mkdir -p /opt/agy && tar xzf /tmp/agy.tgz -C /tmp && mv /tmp/antigravity /opt/agy/agy

# --- ui: builds the admin UI to static files.
FROM node:current-trixie-slim AS ui
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui ./ui
RUN npm run build:ui

# --- deps: the server's runtime dependencies (the database drivers), without the UI's build tools.
FROM node:current-trixie-slim AS deps
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# --- runtime: Node (runs the agent and React/Node projects), pnpm, .NET SDK, git, gh and the three agent CLIs.
FROM ${RUNTIME_IMAGE}
# The .NET SDK majors installed, space-separated. A project's tests need its own major's runtime, which a newer
# SDK doesn't bring: list an older major too while a project still targets it (Node's major is the base image tag).
ARG DOTNET_PACKAGES=dotnet-sdk-11.0
# .NET and gh come from their vendors' apt repositories (signing keys fetched in the tools stage).
COPY --from=tools /opt/apt-keys/ /etc/apt/keyrings/
# chromium brings the system libraries every Playwright browser needs (the agent runs without root, so
# `playwright install --with-deps` can't add them later) and is the browser of the Sentinel's browser tools.
# python3 runs the ui-taste skill's scanner (standard library only).
# `script` (the pseudo-terminal the Claude account login needs) is already in the base. npm is removed:
# pnpm is the only package manager.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && echo "deb [signed-by=/etc/apt/keyrings/microsoft.asc] https://packages.microsoft.com/debian/13/prod trixie main" > /etc/apt/sources.list.d/microsoft.list \
 && echo "deb [signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get -y upgrade \
 && apt-get install -y --no-install-recommends git gh ${DOTNET_PACKAGES} chromium fonts-liberation python3 \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
 && mkdir -p /data/db /data/work /data/auth /data/logs /data/brain && chown -R node:node /data
COPY --from=tools /opt/npm/lib/node_modules/pnpm /usr/local/lib/pnpm
# Claude Code is a standalone native (glibc) binary; the npm wrapper around it is not needed.
COPY --from=tools /opt/npm/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe /usr/local/bin/claude
COPY --from=tools /opt/codex /opt/codex
COPY --from=tools /opt/npm/lib/node_modules/@playwright/mcp /usr/local/lib/playwright-mcp
COPY --from=tools /opt/agy/agy /usr/local/bin/agy
# Resolve pnpm's entry point from its own manifest: its location changes between major versions.
RUN ln -s "/usr/local/lib/pnpm/$(node -p "require('/usr/local/lib/pnpm/package.json').bin.pnpm")" /usr/local/bin/pnpm \
 && ln -s /opt/codex/bin/codex /usr/local/bin/codex \
 && pnpm --version && codex --version && agy --version && claude --version

# Package caches live on the work volume, next to the worktrees, so pnpm can hardlink.
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    NUGET_PACKAGES=/data/work/cache/nuget \
    npm_config_store_dir=/data/work/cache/pnpm-store \
    npm_config_cache_dir=/data/work/cache/pnpm \
    npm_config_manage_package_manager_versions=false \
    PLAYWRIGHT_BROWSERS_PATH=/data/work/cache/ms-playwright

WORKDIR /app
COPY package.json ./
COPY --from=deps /build/node_modules ./node_modules
COPY src ./src
COPY defaults ./defaults
# Shipped defaults must be readable by the non-root agent whatever modes the build context had.
RUN chmod -R a+rX /app/defaults
COPY --from=ui /build/ui/dist ./ui/dist

USER node
ENV HOME=/home/node DATA_DIR=/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/main.ts"]
