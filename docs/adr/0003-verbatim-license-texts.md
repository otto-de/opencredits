# 3. Verbatim license texts verified by integrity checksums

- Status: accepted
- Date: 2026-09-16

## Context

Licenses such as MIT and BSD require the copyright notice itself to be reproduced. A generic license template does not satisfy that, and reference pages such as Spotify's third-party license page show each component's own text.

## Decision

- Show each package's own LICENSE file (and NOTICE file when present) verbatim, taken from the published package archive.
- Only use archive content whose bytes match the lockfile's integrity value (or, without one, the registry checksum).
- When no text is available, link to the SPDX license page for simple identifiers and flag the package for review.
- Extract copyright statements from the texts; fall back to the author field, flagged as inferred.

## Consequences

- The page is larger than one built from shared templates. Texts are collapsed by default and the page compresses well because many texts are similar. Splitting large pages is a future option.
- Enrichment makes two registry requests per unique package version; results are deduplicated before enrichment.
