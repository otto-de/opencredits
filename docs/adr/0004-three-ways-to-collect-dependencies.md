# 4. One tool, three ways to collect dependencies

- Status: accepted
- Date: 2026-10-08

## Context

An app is rarely one repository. Some organisations can point one credential at
everything; others cannot, because repositories belong to different teams with
different access rules. A tool that only supports a central scan is useless to
the second group, and a tool that requires every repository to opt in is
unnecessary work for the first.

## Decision

Keep one engine and one data format, and allow three ways to feed it:

1. **Solo**: `source.type: "local"` scans the checkout it runs in. One repository,
   one page, no credentials.
2. **Central**: `source.type: "github"` discovers an organisation and applies the
   relevance filter, or `source.type: "repositories"` takes an explicit list.
   Listing a repository is itself the statement that it is relevant, so the
   filter is skipped for that source.
3. **Federated**: each repository runs `scan` and publishes its `dataset.json`.
   A central job runs `merge` over those files and renders one page.

The dataset written by `scan` is also the fragment consumed by `merge`: there is
no second format. Merging is defined to be idempotent and order-independent, so
merging a dataset twice changes nothing, and a repository can join or leave
without any central configuration change.

## Consequences

- A team can start solo and later join a federated setup without changing its
  configuration, because the same `scan` output is used either way.
- Merge inputs are local files and directories. CI downloads the artifacts first,
  which keeps the tool out of the business of authenticating to artifact stores.
- The merge step cannot know about a repository that failed to publish a
  fragment; the central workflow warns, and the publish guard catches a resulting
  drop in package count.
- Versions and repository names travel inside fragments, so the merged audit
  report still shows where each library came from while the public page does not.
