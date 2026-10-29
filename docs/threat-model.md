# Threat model

OpenCredits runs with credentials that can read every repository in an organization, processes content written by third parties, and publishes a page on the public internet. This document lists what we protect, what we assume, and the controls in place.

## Assets

- **Credentials:** GitHub App private key, installation tokens, personal access tokens.
- **Internal information:** repository names, dependency versions and scan errors.
- **Integrity of the public page:** it must not execute attacker-controlled content or show wrong notices.
- **The machine running the scan.**

## Trust boundaries

| Input | Trust | Why |
| --- | --- | --- |
| Configuration and curations file | Trusted | Written by the operator and reviewed in the central repository |
| GitHub API responses | Semi-trusted | Authentic, but repository content is written by many people |
| Repository archives | Untrusted | Any contributor to any repository controls file names and content |
| npm registry metadata and tarballs | Untrusted | Written by package authors |
| Syft output | Untrusted | Derived from untrusted repository content |

## Threats and controls

| Threat | Control | Where |
| --- | --- | --- |
| Code execution while scanning | No build tools, package managers or install scripts are run. Only static manifest parsing. Syft is invoked without a shell. | `extract/`, `pipeline.ts` |
| Path traversal or symlink attacks in archives | Only regular files and directories are written; links, devices and `..` or absolute paths are rejected; every target is checked to stay inside a fresh temporary directory. | `fetch/tar.ts` |
| Resource exhaustion | Limits on archive size, decompressed stream size (decompression bombs), per-entry size, total size, entry count, response bodies and subprocess runtime. Manifests-only extraction by default. | `fetch/tar.ts`, `util/http.ts`, config |
| Tampered package tarballs | Tarball bytes are verified against the lockfile integrity (or registry checksum) before any file is read; otherwise content is discarded and the package flagged. Tarballs are only fetched from allowed hosts. | `enrich/npm-registry.ts` |
| Credential leakage to other hosts | GitHub requests and pagination links must match the configured API origin. Tarball redirects never carry the token to third parties. | `github/client.ts` |
| Credential leakage in logs or subprocesses | Secrets are registered and redacted from every log line; GitHub token formats are always redacted; Syft receives a minimal environment without tokens. | `util/log.ts`, `extract/syft.ts` |
| Over-privileged credentials | GitHub App installation tokens are requested with read-only `contents`, `metadata` and `actions` permissions, live for at most an hour and are cached per organization. | `github/auth.ts` |
| Script injection on the public page | All interpolated values are HTML-escaped by the template helper; links must be http(s) without credentials; the page ships no JavaScript and a Content Security Policy of `default-src 'none'` with the stylesheet allowed only by hash. | `render/` |
| CSS injection through configuration | Accent colors must match `#RRGGBB`. | `config/config.ts` |
| Internal information on the public page | Repository names never enter the renderer output; versions only when explicitly enabled. Private and public outputs go to separate directories; private files are written with mode 0600. Tests assert this. | `render/render.ts`, `cli.ts` |
| Publishing an incomplete page after a partial outage | Per-repository failures are isolated and reported; the publish guard blocks rendering when the package count drops beyond a threshold. | `pipeline.ts`, `report/report.ts` |
| Personal data on the public page | Email addresses are stripped from copyright statements and author names by default. | `enrich/license.ts` |
| Supply-chain attack on OpenCredits itself | No runtime dependencies; dev dependencies installed with `--ignore-scripts`; `npm audit signatures`; Syft download verified against release checksums; CodeQL, OpenSSF Scorecard and Dependabot. | CI |

## Operator responsibilities

- Store the App private key as an encrypted secret and rotate it periodically.
- Never publish the data directory (`opencredits-data`); treat it as internal.
- Serve the page with security headers the meta tag cannot set, at minimum `Content-Security-Policy` with `frame-ancestors` limited to the hosts that embed it, `X-Content-Type-Options: nosniff` and `Strict-Transport-Security`.
- Pin GitHub Actions and container base images by digest.
- Review the "Packages needing review" section of the audit summary; a scanner cannot guarantee a complete notice.

## Known gaps (planned)

- The Syft release checksum file is not yet verified with its Sigstore signature.
- Enrichment for ecosystems other than npm does not yet fetch verbatim license texts; those packages are flagged and link to the SPDX license text.
- Container images are not yet signed or published with SLSA provenance.

OpenCredits supports license compliance work but does not provide legal advice.
