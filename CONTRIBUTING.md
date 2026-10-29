# Contributing to OpenCredits

**Thank you for your interest in OpenCredits. Your contributions are highly welcome.**

There are multiple ways of getting involved:

- [Report a bug](#report-a-bug)
- [Suggest a feature](#suggest-a-feature)
- [Contribute code](#contribute-code)

Below are a few guidelines we would like you to follow.
If you need help, please reach out to us by opening an issue.

## Report a bug

Reporting bugs is one of the best ways to contribute. Before creating a bug report, please check that an [issue](../../issues) reporting the same problem does not already exist. If there is such an issue, you may add your information as a comment.

To report a new bug you should open an issue that summarizes the bug and set the label to "bug".

If you want to provide a fix along with your bug report: That is great! In this case please send us a pull request as described in section [Contribute Code](#contribute-code).

Security problems are different: please report them privately as described in [SECURITY.md](SECURITY.md), not as a public issue.

## Suggest a feature

To request a new feature you should open an [issue](../../issues/new) and summarize the desired functionality and its use case. Set the issue label to "feature".

## Contribute code

This is an outline of what the workflow for code contributions looks like

- Check the list of open [issues](../../issues). Either assign an existing issue to yourself, or create a new one that you would like work on and discuss your ideas and use cases.

It is always best to discuss your plans beforehand, to ensure that your contribution is in line with our goals.

- Fork the repository on GitHub
- Create a topic branch from where you want to base your work. This is usually `main`.
- Open a new pull request, label it `work in progress` and outline what you will be contributing
- Make commits of logical units.
- Make sure you sign-off on your commits `git commit -s -m "adding X to change Y"`
- Write good commit messages (see below).
- Push your changes to a topic branch in your fork of the repository.
- As you push your changes, update the pull request with new information and tasks as you complete them
- Project maintainers might comment on your work as you progress
- When you are done, remove the `work in progress` label and ping the maintainers for a review
- Your pull request must receive a :thumbsup: from a [maintainer](MAINTAINERS)

Thanks for your contributions!

### Commit messages

Your commit messages ideally can answer two questions: what changed and why. The subject line should feature the “what” and the body of the commit should describe the “why”.

When creating a pull request, its description should reference the corresponding issue id.

We use [Conventional Commits](https://www.conventionalcommits.org/) prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), which drive the changelog. A breaking change needs a `BREAKING CHANGE:` footer and a section in [docs/migration.md](docs/migration.md).

### Sign your work / Developer certificate of origin

All contributions (including pull requests) must agree to the Developer Certificate of Origin (DCO) version 1.1. This is exactly the same one created and used by the Linux kernel developers and posted on http://developercertificate.org/. This is a developer's certification that he or she has the right to submit the patch for inclusion into the project. Simply submitting a contribution implies this agreement, however, please include a "Signed-off-by" tag in every patch (this tag is a conventional way to confirm that you agree to the DCO) - you can automate this with a [Git hook](https://stackoverflow.com/questions/15015894/git-add-signed-off-by-line-using-format-signoff-not-working)

```
git commit -s -m "adding X to change Y"
```

## Development setup

Requirements: Node.js 22 LTS (see `.nvmrc`). Syft is optional for local development.

```sh
npm ci
npm run lint
npm test
```

`npm test` compiles the project and runs the full test suite with Node's built-in test runner. No network access is needed: the tests use local mock servers.

## Coding standards

- **TypeScript strict mode** with the extra checks in `tsconfig.json`. Code must compile without warnings.
- **No runtime dependencies.** OpenCredits processes untrusted input and runs with credentials, so every dependency is attack surface. A proposal to add one needs an ADR explaining why the standard library is not enough.
- **Treat all scanned data as untrusted.** Package names, license texts, URLs and archive contents come from third parties. Render through the `html` template helper, validate URLs with `toSafeHttpUrl`, and never pass scanned data to a shell.
- **Never log secrets.** Use the `log` helper, which redacts registered secrets and GitHub token formats.
- **Public versus private output.** Repository names and versions belong in the private data directory only. Tests enforce this; keep it that way.
- **Accessibility.** Changes to the page must keep WCAG 2.1 AA: semantic HTML, keyboard access, visible focus, 4.5:1 text contrast and 44px touch targets.
- Every source file starts with SPDX headers:

  ```ts
  // SPDX-FileCopyrightText: 2026 OpenCredits contributors
  // SPDX-License-Identifier: Apache-2.0
  ```

## Tests

Every change needs tests. Bug fixes start with a test that fails without the fix. Security-relevant code (archive handling, escaping, URL handling, credentials) needs tests for the malicious case as well as the normal one.

CI must pass before a merge: type check, lint, tests, REUSE compliance and CodeQL.

## Branching and releases

The project uses **GitHub Flow**: `main` is always releasable, and every change arrives through a short-lived topic branch and a pull request.

- Branch names: `feat/<short-description>`, `fix/<short-description>`, `docs/<short-description>`.
- `main` is protected: pull requests require a review from a [maintainer](MAINTAINERS) and a green CI run.
- A release is a tag `vMAJOR.MINOR.PATCH` on `main`, following [SemVer](https://semver.org/). Pushing the tag runs the release workflow, which verifies that the tag, `package.json` and `CHANGELOG.md` agree before publishing anything.
- Release notes come from the matching `CHANGELOG.md` section, so write that section in the pull request that makes the change.

Backward compatibility comes first. Where a breaking change is unavoidable, keep the old behaviour working for one minor version with a warning where that is possible, and document the upgrade path in [docs/migration.md](docs/migration.md).

## Architecture decisions

Significant design choices are recorded in [`docs/adr`](docs/adr). Copy the format of an existing ADR, number it sequentially, and link it from your pull request.

**Have fun, and happy hacking!**
