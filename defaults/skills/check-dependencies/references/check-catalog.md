# Dependencies check catalog

| ID | Check | Base severity | Evidence to review |
|---|---|---:|---|
| DEP01 | Known vulnerabilities in runtime dependencies | Critical | Advisories (GHSA, CVE) matching installed runtime packages, direct and transitive; whether the vulnerable feature is used. |
| DEP02 | Known vulnerabilities in development dependencies | Low | The same for build and test tooling; higher when the tool runs in CI with secrets. |
| DEP03 | End-of-life runtimes and frameworks | High | Node.js, .NET, React, ASP.NET Core and other frameworks past end of support (`engines`, `TargetFramework`, `global.json`, Docker base images). |
| DEP04 | Outdated major versions | Medium | Direct dependencies two or more majors behind, especially ORMs, auth libraries, HTTP and serialization libraries. |
| DEP05 | Deprecated and abandoned packages | Medium | Packages marked deprecated, archived repositories, no release in years, with a named successor when there is one. |
| DEP06 | License compatibility | High | Copyleft (GPL, AGPL) or unknown licenses in what is distributed; licenses missing for internal packages. `ATTENTION` when license data is not available offline. |
| DEP07 | Lockfile integrity | Medium | A lockfile committed for every manifest, consistent with the manifest, one package manager per project, `--frozen-lockfile` / locked restore in CI. |
| DEP08 | Duplicated versions | Low | Several versions of the same library (React, lodash, Newtonsoft and System.Text.Json side by side) inflating bundles or behavior. |
| DEP09 | Unused and misplaced dependencies | Low | Packages with no import or `using`; build tools in `dependencies`; runtime packages in `devDependencies`. |
| DEP10 | Risky install scripts and sources | High | Dependencies with `postinstall` scripts, packages from git URLs or tarballs, private registries without scoping, typosquatting-like names. |
| DEP11 | Version pinning | Medium | Ranges that let a new major or a compromised release in (`*`, `latest`, `>=`), floating NuGet versions, unpinned Docker base images and CI actions. |
| DEP12 | Update automation | Medium | Dependabot or Renovate configuration covering every ecosystem in the repository (npm, NuGet, Docker, GitHub Actions). |

## Stack notes

- **pnpm**: `pnpm audit --json` and `pnpm outdated --format json` read the lockfile; `onlyBuiltDependencies` controls install scripts.
- **.NET**: `dotnet list package --vulnerable --include-transitive` and `--outdated` need a restore; central package management in `Directory.Packages.props`.
