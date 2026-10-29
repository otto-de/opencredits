<!-- SPDX-FileCopyrightText: 2026 OpenCredits contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Open source release checklist

This project follows the OTTO Open Source Guidelines, the licensing guidance and
the `new-project` template. The tables say what is satisfied in the repository
and what a maintainer still has to do, because several requirements are
organisational and cannot be met by code.

Legend: **Done** means it is in the repository. **Open** means a person has to
act.

## 1. Files from the new-project template

| Template file | Status | Notes |
| --- | --- | --- |
| `LICENSE` | Done | Apache 2.0, copied from the template verbatim |
| `OSSMETADATA` | Done | `osslifecycle=incubation`, the template's exact format |
| `MAINTAINERS` | Done | Umesh Nebhani. **Confirm the email address** |
| `CONTRIBUTORS.md` | Done | Empty until the first external contribution |
| `CODE_OF_CONDUCT.md` | Done | Template verbatim, reports go to `opensource@otto.de` |
| `CONTRIBUTING.md` | Done | Template structure, plus this project's development setup, coding standards and branching |
| `SECURITY.md` | Done | Template wording, disclosure to `disclosure@otto.de`, plus scope |
| `README.md` | Done | Template section structure, with the OSS Lifecycle badge |
| `.github/CODEOWNERS` | Done | Points at `@otto-de/opencredits-maintainers`. **Create that team, or replace it with your handle** |
| `.github/ISSUE_TEMPLATE.md` | Done | Template verbatim |
| `.github/PULL_REQUEST_TEMPLATE.md` | Done | Template verbatim |

The project adds files the template does not have: `CHANGELOG.md`, `NOTICE`,
`REUSE.toml`, `docs/` (threat model, migration guide, ADRs), `.github/workflows/`
and `.github/dependabot.yml`. `GOVERNANCE.md` was removed, because `MAINTAINERS`
and `CONTRIBUTING.md` now cover it the way the template intends.

## 2. General prerequisites

| Guideline | Status | Where |
| --- | --- | --- |
| Comprehensive README: purpose, use, contribution | Done | [README.md](../README.md) |
| Semantic versioning | Done | `package.json`, [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Changelog | Done | [CHANGELOG.md](../CHANGELOG.md) |
| Apache 2.0 or MIT license | Done: Apache-2.0 | [LICENSE](../LICENSE) |
| Lifecycle state in OSSMETADATA | Done, `incubation` | Move to `active` when it is ready for production use |
| Moderation of issues and pull requests, or disable issues | **Open** | Enable notifications and set branch protection on `main` |
| Version marked in code | Done | `--version` reads `package.json` |
| Branching strategy | Done: GitHub Flow | [CONTRIBUTING.md](../CONTRIBUTING.md#branching-and-releases) |
| Release notes per version | Done, automated | `.github/workflows/release.yml` builds them from the changelog |
| Tags and GitHub releases | Done, automated | Pushing `vX.Y.Z` runs the release workflow |
| Backward compatibility and migration guides | Done | [docs/migration.md](migration.md) |
| Maintainer responsibilities defined | Done | [CONTRIBUTING.md](../CONTRIBUTING.md), [MAINTAINERS](../MAINTAINERS) |
| Community involvement in releases | **Open** | Organisational: decide how feedback is gathered once public |
| DCO sign-off required | Done, documented | **Open**: enable the DCO check in repository settings so it is enforced |

## 3. Publishing artifacts

| Guideline | Status | Where |
| --- | --- | --- |
| Clear manifest with metadata and dependencies | Done | `package.json`, `Dockerfile` |
| Automated build and publish | Done | `.github/workflows/release.yml` publishes to npm with provenance and to the container registry with an SBOM |
| Consistent versioning enforced | Done | The release job fails if the tag, `package.json` and changelog disagree |
| Registry credentials | **Open** | Create the `NPM_TOKEN` secret and a protected `release` environment, or delete the npm job if you publish only the container image |

## 4. Preventing vulnerabilities and code quality

| Guideline | Status | Where |
| --- | --- | --- |
| CodeQL | Done | `.github/workflows/codeql.yml` |
| Dependabot | Done: npm, Actions, Docker | `.github/dependabot.yml` |
| OpenSSF Scorecard | Done | `.github/workflows/scorecard.yml` |
| Tests | Done: 89 tests, including malicious-input cases | `test/` |
| Lint and type checks in CI | Done | `.github/workflows/ci.yml` |
| **Run `npm install` and commit `package-lock.json`** | **Open** | CI uses `npm ci`, which fails without it. This also produces the first real lint run; ESLint is configured but has never been executed |
| **Pin all GitHub Actions to commit SHAs** | **Open** | Currently pinned to tags (`@v4`). Scorecard penalises this and it is a supply-chain risk |
| Pin container base images by digest | **Open** | `Dockerfile` uses `node:22-bookworm-slim` |
| Internal penetration test before publishing | **Open** | Request from `security-analyse@otto.de`; [docs/threat-model.md](threat-model.md) defines the scope |

## 5. Data classification and exposure

| Guideline | Status | Notes |
| --- | --- | --- |
| No internal references in the source | Done | Only the organisation name `otto-de` and the public addresses from the template. No internal host names, systems or infrastructure appear anywhere |
| No internal dependencies | Done | No runtime dependencies at all; nothing OTTO-specific is required to run it |
| Source classifiable as I1 (public) | **Open** | The code contains no business logic, data or secrets, but the classification itself is an organisational step |
| No secrets in the repository | Done | Credentials come from environment variables only; `.gitignore` excludes `*.pem` and `.env*`; logs redact secrets |
| Colleagues aware the repository is public | **Open** | Announce internally before making it public, so nobody posts internal detail in issues |
| Collaborator review | **Open** | The public `otto-de` organisation may contain members beyond your team; review who can push |

## 6. Licensing guidance applied to this project

| Requirement | Status | Notes |
| --- | --- | --- |
| Apache 2.0 or MIT for the project | Done: Apache-2.0 | Matches the template and the guidance |
| The project's own dependencies must be permissive | Done | Five development dependencies (ESLint, TypeScript and their plugins), all MIT or Apache-2.0; no runtime dependencies |
| Strong copyleft must not be used in an open source project | Done | None present |
| AGPL and variants must not be used anywhere | Done | None present. AGPL, SSPL, RPL, EUPL and CPAL are all forbidden by the shipped ruleset |
| Commons Clause must not be used | Done | None present; detected and forbidden by the ruleset |
| Unlicensed code must not be used | Done | All dependencies carry a declared license; undetermined licenses are reported for review |
| Elastic License treated case by case | Done | Classified as `case-by-case`, which produces a review finding |
| LGPL treated as strong copyleft | Done | The `conservative` ruleset is now the **default**, matching the guidance |
| **Confirm the licensing guidance link** | **Open** | `policy.guidelinesUrl` in the organisation example points at a plausible path; set the real one |
| Verify dependency licenses at release time | **Open after lock file** | Run the tool on itself once `package-lock.json` exists, as a self-check |

## 7. Remaining placeholders

| Placeholder | Where | Replace with |
| --- | --- | --- |
| `umesh.nebhani@otto.de` | [MAINTAINERS](../MAINTAINERS) | Your actual work address, if it differs |
| `@otto-de/opencredits-maintainers` | `.github/CODEOWNERS` | Create that GitHub team, or use your personal handle |
| `https://github.com/otto-de/opensource/blob/main/_docs/licensing.md` | `examples/github-organization/opencredits.config.json`, README | The real licensing guidance URL |
| `otto-de/shop-web`, `otto-de/shop-checkout` | Example configurations | Real repository names, when you write the production configuration |
| `example.com` | Example relevance configuration | Your production domains |

## 8. Suggested order

1. Confirm the maintainer email and create the CODEOWNERS team.
2. Run `npm install`, commit `package-lock.json`, run `npm run lint` and fix
   anything it reports.
3. Replace the remaining placeholders in section 7.
4. Pin Actions and base images.
5. Enable branch protection, issue moderation, the DCO check and private
   vulnerability reporting in the repository settings.
6. Request the penetration test and the I1 data classification.
7. Announce internally, then make the repository public under `otto-de`.
8. Push the first tag and let the release workflow publish it.
9. When it is running in production, change `OSSMETADATA` to
   `osslifecycle=active`.
