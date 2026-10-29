# Federated setup

Use this when no single credential may read every repository, or when each team
wants to own its own scan. Each repository scans itself and publishes its
`dataset.json` as a build artifact; a central job combines them into one page.

- `team-repository.yml` goes into each participating repository.
- `central-merge.yml` goes into the repository that publishes the page.

Both files are workflow examples: copy them to `.github/workflows/` and adjust
the repository names. The central job needs a token that can download artifacts
from the participating repositories.

A repository can join or leave by adding or removing its workflow. Nothing in
the central configuration has to change, because the merge step reads whatever
datasets it is given.
