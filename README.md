# OpenCredits

## Status

![OSS Lifecycle](https://img.shields.io/osslifecycle?file_url=https%3A%2F%2Fraw.githubusercontent.com%2Fotto-de%2Fopencredits%2Fmain%2FOSSMETADATA)
[![CI](https://github.com/otto-de/opencredits/actions/workflows/ci.yml/badge.svg)](https://github.com/otto-de/opencredits/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/otto-de/opencredits/badge)](https://securityscorecards.dev/viewer/?uri=github.com/otto-de/opencredits)
[![REUSE](https://api.reuse.software/badge/github.com/otto-de/opencredits)](https://api.reuse.software/info/github.com/otto-de/opencredits)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

## About

OpenCredits collects the open source libraries your software is built on, checks
their licenses against your policy, and publishes a credits page listing each
library with its license, copyright holders, source link and full license text.

Publishing third-party notices is easy for one repository and hard for a company.
Dependencies are spread across many repositories, some of which are experiments
that never reach users, and most scanners give you package names and license
identifiers but not the copyright notices that the licenses actually require.

OpenCredits finds the repositories that really ship and produces a page you can
publish as it is, so a recurring legal obligation becomes a nightly job rather
than manual work before every release.

- **Fits how your repositories are organised.** Scan one repository, a named list
  of repositories, a whole GitHub organisation, or let each team scan itself and
  combine the results. The scanned repositories need no changes.
- **Covers any technology.** A built-in npm lockfile reader, plus
  [Syft](https://github.com/anchore/syft) for Java, Go, Python, .NET, Ruby, PHP,
  Rust, Swift, Dart and more.
- **Shows real notices.** For npm packages it publishes each package's own LICENSE
  and NOTICE file, after verifying the archive against the lockfile checksum.
- **Checks your license policy.** Every dependency is classified, and anything
  that needs a decision is reported, optionally failing the build.
- **Keeps internal data internal.** Repository names and versions stay in a
  private data directory and never reach the page.
- **Produces a page anyone can use.** Static HTML without JavaScript, WCAG 2.1 AA,
  mobile and in-app web views, dark mode, English and German.

### The three ways to run it

| | Who scans | Credentials needed | Example |
| --- | --- | --- | --- |
| **Solo** | The repository scans itself | None | [`examples/single-repository`](examples/single-repository) |
| **Central** | One job scans a list of repositories, or discovers an organisation | One credential that can read them all | [`examples/multi-repository`](examples/multi-repository), [`examples/github-organization`](examples/github-organization) |
| **Federated** | Each repository scans itself and publishes its dataset; one job combines them | Each repository uses its own | [`examples/federated`](examples/federated) |

All three produce the same `dataset.json`, and `merge` combines any number of
them. A team can start solo and join a federated setup later without changing its
configuration. Merging is idempotent and order-independent, so a repository can
join or leave without touching the central configuration.

### How it works

```text
repositories ──▶ 1. Discover and filter ──▶ 2. Extract dependencies ──▶ 3. Enrich licenses
                                                                                │
   public page ◀── 6. Render ◀── publish guard ◀── 5. Check policy ◀── 4. Deduplicate
                                                          │                     ▲
                                                          │                     └── curations
                                                          └──▶ private: dataset, SPDX SBOM, audit report
```

1. **Discover and filter.** For an organisation, a relevance filter includes
   repositories with recent successful CI runs or deployment configuration
   referencing your domains, and excludes archived projects, forks and
   playgrounds. For an explicit list, every listed repository is scanned.
2. **Extract.** Dependency manifests and lockfiles are read from each repository's
   archive. Nothing is built or installed.
3. **Enrich.** Packages get license expressions, verbatim license texts,
   copyright statements and repository links.
4. **Deduplicate** across repositories and versions, and apply your **curations**.
5. **Check policy** against the license ruleset.
6. **Render**, unless the **publish guard** sees a suspicious drop in packages.

## Getting Started

These instructions get you a credits page for one repository in a few minutes.
See [Deployment](#deployment) for how to publish it.

### Prerequisites

- [Node.js](https://nodejs.org/) 22 LTS or later (see `.nvmrc`).
- Optional: [Syft](https://github.com/anchore/syft), for ecosystems other than
  npm. The container image and the GitHub Action install it for you.
- For scanning a GitHub organisation: a GitHub App or a token with read-only
  access.

### Installing

Add `opencredits.config.json` to your repository:

```json
{
  "source": { "type": "local", "paths": ["."] },
  "output": { "title": "Open source licenses", "language": "en" }
}
```

Run it:

```sh
npx opencredits run
```

Open `opencredits-site/index.html`. That is the finished page.

To see it working on a prepared project first:

```sh
npm install
npm run demo
```

This scans [`examples/demo-shop`](examples/demo-shop), a small frontend with five
real libraries, and writes a page to `demo-output/site/index.html`.

### Scanning several repositories

List them and scan from one place:

```json
{
  "source": {
    "type": "repositories",
    "repositories": ["otto-de/shop-web", "otto-de/shop-checkout"],
    "auth": "token"
  }
}
```

If no single credential may read all of them, use the federated setup instead:
each repository runs `opencredits scan` and uploads
`opencredits-data/dataset.json`; a central job downloads those files and runs
`opencredits merge --inputs fragments`.

### Scanning a whole organisation

1. **Create a GitHub App** owned by your organisation with read-only *Contents*,
   *Metadata* and *Actions* permissions. Install it on all repositories and
   generate a private key.
2. **Create a central repository** with
   [`opencredits.config.json`](examples/github-organization/opencredits.config.json),
   an optional [`curations.json`](examples/github-organization/curations.json) and
   the [scheduled workflow](examples/github-organization/credits.yml).
3. **Store credentials**: the App ID as the variable `OPENCREDITS_GITHUB_APP_ID`
   and the private key as the secret `OPENCREDITS_GITHUB_APP_PRIVATE_KEY`.

Review `audit-summary.md` after the first run: it lists excluded repositories
with reasons, failures, policy findings and packages whose notice may be
incomplete.

## Commands

| Command | What it does |
| --- | --- |
| `opencredits run` | Scan, check the publish guard, render the page |
| `opencredits scan` | Scan only, and write the dataset other runs can merge |
| `opencredits merge --inputs <paths>` | Combine datasets from several scans into one page |
| `opencredits render --dataset <file>` | Render the page from an existing dataset |
| `opencredits validate` | Check the configuration |

Common options: `--config` (default `opencredits.config.json`), `--data-dir`
(default `opencredits-data`), `--site-dir` (default `opencredits-site`).

Exit codes: `0` success, `1` failure, `2` invalid configuration, `3` publish guard
blocked the result, `4` the license policy blocked it.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `OPENCREDITS_GITHUB_APP_ID` | GitHub App ID (with `auth: "app"`) |
| `OPENCREDITS_GITHUB_APP_PRIVATE_KEY` or `..._PATH` | GitHub App private key (PEM) |
| `OPENCREDITS_GITHUB_TOKEN` or `GITHUB_TOKEN` | Token (with `auth: "token"`), read-only |
| `OPENCREDITS_LOG_LEVEL` | `debug`, `info` (default), `warn`, `error`. JSON lines on stderr. |

## Outputs

| Path | Audience | Contents |
| --- | --- | --- |
| `opencredits-site/index.html` | Public | The credits page |
| `opencredits-data/dataset.json` | Internal | Deduplicated packages with versions, repositories and quality flags. This is also the fragment `merge` consumes. |
| `opencredits-data/sbom.spdx.json` | Internal | SPDX 2.3 document for other compliance tools |
| `opencredits-data/audit-report.json` | Internal | Repository decisions, failures, policy findings, packages needing review |
| `opencredits-data/audit-summary.md` | Internal | Human-readable summary, also added to the GitHub job summary |

> **Never publish `opencredits-data`.** It names internal repositories.

## License policy

Every dependency is classified into a category, and the category plus your
project type decides the verdict:

| Category | Examples | Internal | Distributed or public service |
| --- | --- | --- | --- |
| Permissive | MIT, Apache-2.0, BSD, ISC | Allowed | Allowed |
| Weak copyleft | MPL-2.0, EPL-2.0, CDDL | Allowed | Allowed, publish this dependency's source and your changes |
| Strong copyleft | GPL, LGPL, OSL, QPL | Allowed | **Forbidden** |
| Network copyleft | AGPL, SSPL, EUPL, CPAL, RPL | **Forbidden** | **Forbidden** |
| Not open source | Commons Clause, BUSL, unlicensed | **Forbidden** | **Forbidden** |
| Case by case | Elastic 2.0 | Review | Review |
| Undetermined | no license found | Review | Review |

```json
{
  "policy": {
    "guidelinesUrl": "https://github.com/otto-de/opensource/blob/main/_docs/licensing.md",
    "projectType": "distributed",
    "ruleset": "conservative",
    "failOn": "forbidden",
    "exceptions": [
      { "package": "some-gpl-tool", "reason": "Build-time only, approved by legal on 2026-10-01" }
    ]
  }
}
```

- `guidelinesUrl` links your organisation's own license guidelines. Every audit
  report points at it, so a reader checks the authoritative document instead of
  trusting this tool's defaults.
- `ruleset: "conservative"` treats the Lesser GPL as strong copyleft, matching
  license guidance that forbids the whole GPL family in distributed software.
  `"standard"` treats it as weak copyleft instead.
- `failOn` controls exit code 4. The page is always written first, so a policy
  problem never leaves you without a report.
- Exceptions need a written reason and stay in the report as accepted risks.
- `overrides` reclassifies any individual license.

SPDX expressions are evaluated by operator: `MIT OR GPL-3.0-only` counts as
permissive because it is a choice, while `MIT AND GPL-3.0-only` counts as strong
copyleft because both sets of obligations apply.

This supports compliance work; it is not legal advice. Have your legal team
review the result and adjust the ruleset to your own policy.

## Configuration

All settings and defaults are in the
[JSON Schema](schema/opencredits.config.schema.json). Reference it with
`"$schema"` for editor completion. The most important ones:

| Setting | Default | Notes |
| --- | --- | --- |
| `source.type` | `local` | `local`, `repositories` or `github` |
| `relevance.ciWindowDays` | `30` | Recent successful CI run makes a repository relevant |
| `relevance.deploymentDomains` | `[]` | For example `["example.com"]`; subdomains match |
| `relevance.allowlist` / `denylist` | `[]` | `owner/repo`; denylist wins |
| `extraction.includeDevDependencies` | `false` | Dev dependencies are usually not distributed |
| `output.language` | `en` | `en` or `de` |
| `output.showVersions` | `false` | Versions stay in the private dataset |
| `output.accentColor` | `#1F5F8B` | Validated for 4.5:1 contrast |
| `policy.guidelinesUrl` | `null` | Link to your own license guidelines, shown in every report |
| `policy.failOn` | `none` | `none`, `forbidden` or `review` |
| `guard.maxPackageDropPercent` | `30` | Blocks rendering after a suspicious drop |

### Curations

Scanners cannot know everything. A curations file corrects packages and adds
components that no package manager declares, such as source files copied into a
repository. Every entry needs a `reason`, which appears in the audit trail. See
[`examples/github-organization/curations.json`](examples/github-organization/curations.json).

## Running the tests

```sh
npm ci
npm test
```

`npm test` compiles the project and runs the full suite with Node's built-in test
runner. It needs no network access: GitHub and the npm registry are replaced by
local mock servers.

The suite covers the pipeline end to end, and the security-relevant cases
deliberately use malicious input: path traversal and symlinks in archives,
decompression bombs, script injection in package metadata, tampered package
archives, and credentials being redirected to another host.

Coding style and types are checked separately:

```sh
npm run lint
npm run typecheck
```

## Deployment

`opencredits run` writes a directory of static files, so any web server, object
storage or CDN can serve it. Publish only `opencredits-site`, never
`opencredits-data`.

Serve the page with the security headers that a meta tag cannot set: at minimum
`Content-Security-Policy` with `frame-ancestors` limited to the hosts that embed
it, `X-Content-Type-Options: nosniff` and `Strict-Transport-Security`.

In CI, the [GitHub Action](action.yml) runs the same commands. The example
workflows upload the page as a build artifact; add a deployment step for your own
hosting.

## Accessibility

The page uses semantic landmarks and headings, a skip link, an alphabetical
index, native expandable sections for license texts, visible keyboard focus,
touch targets of at least 44 pixels, a zoom-friendly layout, dark mode, Windows
high-contrast support and print styles. It needs no JavaScript.

Automated tests check heading order, unique ids, valid in-page links and the
language attribute, and the configuration rejects accent colors below 4.5:1
contrast. Test with a screen reader before each major release.

## Security

OpenCredits is designed to process untrusted repositories and package metadata
safely: it never builds or installs code, extracts archives with strict limits,
verifies package checksums, sends credentials only to the configured API, redacts
secrets from logs, and escapes all content on the page behind a strict Content
Security Policy. See the [threat model](docs/threat-model.md) and report
vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Built With

* [Node.js](https://nodejs.org/) - Runtime, 22 LTS or later
* [TypeScript](https://www.typescriptlang.org/) - Language, strict mode
* [Syft](https://github.com/anchore/syft) - Optional, for ecosystems other than npm

OpenCredits has **no runtime dependencies**. Everything else uses the Node.js
standard library, which keeps the supply-chain attack surface as small as
possible.

## Current limitations

- Verbatim license texts are fetched for npm packages. Other ecosystems get the
  license identifier from Syft and a link to the SPDX text, and are flagged for
  review. Enrichment from ClearlyDefined and Maven Central is planned.
- Dependencies in yarn and pnpm lockfiles are read through Syft, which does not
  separate development dependencies as precisely as the npm reader.
- GitHub is the only repository host so far.
- The page is a single file. Very large organisations may want pagination.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our process for
submitting pull requests to us, and please ensure you follow the
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Design decisions are recorded in [`docs/adr`](docs/adr), and the
[release checklist](docs/open-source-release-checklist.md) tracks readiness for
publication.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available,
see the [tags on this repository](https://github.com/otto-de/opencredits/tags).
Upgrade notes for breaking changes are in [docs/migration.md](docs/migration.md).

## Authors

See the [MAINTAINERS](MAINTAINERS) file for the current maintainers, and the list
of [contributors](CONTRIBUTORS.md) who participated in this project.

## License

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE)
file for details

## Acknowledgments

* Thanks to [@PurpleBooth](https://github.com/PurpleBooth) for the original readme
* Thanks to the [@zalando/Nakadi](https://github.com/zalando/nakadi) project for Contribution file
* Thanks to [@SteveMao](https://github.com/stevemao) for [Issue templates](https://github.com/stevemao/github-issue-templates)
* Thanks to the [Anchore](https://github.com/anchore/syft) team for Syft
