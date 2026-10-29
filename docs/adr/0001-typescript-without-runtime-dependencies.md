# 1. TypeScript on Node.js without runtime dependencies

- Status: accepted
- Date: 2026-09-16

## Context

The tool runs with organization-wide read credentials and processes untrusted archives and metadata. Every runtime dependency adds attack surface and maintenance. The original proposal favoured Go because Syft could be embedded as a library; Node.js was the documented alternative.

## Decision

Implement OpenCredits in strict TypeScript on Node.js 22 LTS, using only the standard library at runtime (HTTP via `fetch`, JWT signing via `crypto`, gzip via `zlib`, argument parsing via `util.parseArgs`, tests via `node:test`). Syft is invoked as an external binary.

## Consequences

- No third-party code runs with the scanner's credentials, and the container image needs no `node_modules`.
- We maintain small, well-tested implementations of a tar reader, glob matcher and JSON config validation.
- Configuration is JSON (validated at runtime and described by a JSON Schema) rather than YAML, which would need a parser dependency.
- Syft must be installed separately; the container image and GitHub Action do this with checksum verification. Without Syft, npm projects are still fully supported.
