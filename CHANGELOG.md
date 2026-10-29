# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-28

### Changed

- **The repository now follows the otto-de `new-project` template**: `LICENSE`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, the issue and pull request templates and
  the README structure come from it, and `OSSMETADATA` uses the template's
  `osslifecycle=` format. Added `MAINTAINERS`, `CONTRIBUTORS.md` and
  `.github/CODEOWNERS`; removed `GOVERNANCE.md`, which the template covers
  through `MAINTAINERS` and `CONTRIBUTING.md`.
- The organisation is `otto-de` throughout: badges, examples and action
  references.
- **`policy.ruleset` now defaults to `conservative`**, so the Lesser GPL counts
  as strong copyleft unless a project opts into `standard`. This matches license
  guidance that forbids the GPL family in distributed software, and is the safer
  default. A project that wants the previous behaviour sets
  `"ruleset": "standard"`.

### Added

- Release workflow publishing to npm (with provenance) and the container
  registry, gated on the tag, `package.json` and `CHANGELOG.md` agreeing.
- Documented branching strategy (GitHub Flow) in `CONTRIBUTING.md`.
- `docs/migration.md` with the 0.1.x to 0.2.x upgrade path.
- `policy.guidelinesUrl`: a link to the organisation's own license guidelines.
  Every audit report points at it, so the categories are presented as an
  implementation of that document rather than as rules of this tool's own.

## [0.2.0] - 2026-10-08

### Added

- Explicit repository lists (`source.type: "repositories"`) for an app built from
  several repositories, scanned from one place. Listing a repository means it is
  relevant, so the relevance filter is skipped for it.
- `merge` command, combining the datasets of separate scans into one page. This
  enables the federated setup, where each repository scans itself and a central
  job consolidates the results. Merging is idempotent and order-independent.
- License policy check: every dependency is classified (permissive, weak
  copyleft, strong copyleft, network copyleft, not open source, case by case,
  undetermined) and reported with a verdict based on the project type. SPDX
  expressions are evaluated by operator. Configurable rulesets, per-license
  overrides and exceptions that require a written reason. New exit code 4.
- Merged sources and policy findings in the audit report and summary.
- Example setups for the multi-repository and federated ways of running the tool.
- `OSSMETADATA` and an open source release checklist.

### Changed

- **The project is now called OpenCredits.** The command, the configuration file
  (`opencredits.config.json`), the output directories (`opencredits-data`,
  `opencredits-site`) and the environment variables (`OPENCREDITS_*`) were renamed.
  Projects on 0.1.0 must rename their configuration file and secrets.
- Audit report schema version is now `1.1`, adding the `sources` and `policy`
  fields. The dataset schema is unchanged, so 0.1.0 datasets can still be merged.
- Local scans in GitHub Actions label themselves with `GITHUB_REPOSITORY`, so
  fragments carry the real repository name.
- Examples use neutral names (`otto-de`, `example.com`).

## [0.1.0] - 2026-09-16

### Added

- GitHub organization discovery with a relevance filter: allowlist, denylist, archived and fork exclusion, recent successful CI runs, and deployment configuration that references configured domains.
- GitHub App authentication with down-scoped, read-only installation tokens, and token authentication.
- Safe archive extraction with manifests-only mode and size, count and path limits.
- npm lockfile extractor (lockfile versions 1 to 3) and a Syft extractor for other ecosystems.
- npm registry enrichment: verbatim license and notice files verified against lockfile integrity, copyright extraction and repository links.
- Curations and manual additions with mandatory reasons.
- Deduplication across repositories and versions with stable anchors.
- Private outputs: dataset, SPDX 2.3 document, audit report and Markdown summary.
- Publish guard against sudden drops in package count.
- Static, accessible license page in English and German with a strict Content Security Policy.
- Command line interface, container image and GitHub Action.
