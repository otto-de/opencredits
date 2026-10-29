# 2. Repository relevance filter

- Status: accepted
- Date: 2026-09-16

## Context

Organizations contain many repositories that do not ship to users: playgrounds, prototypes, archived projects and forks. Scanning them adds noise to a public legal page and wastes API quota.

## Decision

Evaluate rules in this order and stop at the first decisive one:

1. Denylist: exclude.
2. Allowlist: include (manual override for repositories that cannot be detected automatically).
3. Archived or fork: exclude (both configurable).
4. A successful workflow run on the default branch within `ciWindowDays`: include.
5. A deployment file (Kubernetes, Helm, Terraform patterns) referencing a configured domain or subdomain: include.
6. Otherwise exclude.

Every decision is recorded with human-readable reasons in the private audit report.

## Consequences

- Cheap checks run first; the tree listing and file reads only happen for repositories without recent CI.
- Repositories deployed by a central infrastructure repository (not by their own configuration) and without recent CI are missed; the allowlist covers them, and the audit report makes the exclusion visible.
- Future signals (GitHub Deployments API, repository topics or custom properties) can be added as further rules.
