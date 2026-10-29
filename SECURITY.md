We acknowledge that every line of code that we write may potentially contain security issues.
We are trying to deal with it responsibly and provide patches as quickly as possible.

If you have found a security related issue, please write to [disclosure](mailto:disclosure@otto.de)

Please do not open a public issue for a security problem.

## What to include

The affected version, a description of the impact, and the steps or a proof of
concept needed to reproduce it.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.x (latest minor) | Yes |
| Older minors | No |

## Scope

OpenCredits reads source code from many repositories and publishes a public web
page, so we are especially interested in:

- Code execution or file writes outside the working directory while scanning a
  repository or a package archive.
- Script injection, or any other way to make the generated page execute content
  taken from package metadata.
- Credentials (GitHub tokens, App private keys) leaking into logs, outputs or
  subprocesses.
- Internal information (repository names, versions) reaching the public page.
- Any way to make OpenCredits send credentials to a host other than the
  configured API.

The security design is described in [docs/threat-model.md](docs/threat-model.md).
