<!-- SPDX-FileCopyrightText: 2026 OpenCredits contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Migration guide

## 0.1.x to 0.2.x

The project was renamed from NoticeHub to OpenCredits. The engine, the data
format and the page are unchanged, so an existing `dataset.json` still works and
can be merged. Only names change.

### Rename your configuration file

```sh
git mv noticehub.config.json opencredits.config.json
```

If you reference the JSON Schema, update the path to
`schema/opencredits.config.schema.json`.

### Rename environment variables and secrets

| Before | After |
| --- | --- |
| `NOTICEHUB_GITHUB_APP_ID` | `OPENCREDITS_GITHUB_APP_ID` |
| `NOTICEHUB_GITHUB_APP_PRIVATE_KEY` | `OPENCREDITS_GITHUB_APP_PRIVATE_KEY` |
| `NOTICEHUB_GITHUB_APP_PRIVATE_KEY_PATH` | `OPENCREDITS_GITHUB_APP_PRIVATE_KEY_PATH` |
| `NOTICEHUB_GITHUB_TOKEN` | `OPENCREDITS_GITHUB_TOKEN` |
| `NOTICEHUB_LOG_LEVEL` | `OPENCREDITS_LOG_LEVEL` |

`GITHUB_TOKEN` is unchanged.

### Update output paths in your workflows

| Before | After |
| --- | --- |
| `noticehub-data` | `opencredits-data` |
| `noticehub-site` | `opencredits-site` |

### Update the action reference

```yaml
- uses: your-org/opencredits@v0.2.1
```

### New in 0.2.x, nothing required

- The license policy check is on by default but reports only: `policy.failOn`
  defaults to `none`, so no build starts failing after the upgrade. Set it to
  `forbidden` when you are ready to enforce.
- `source.type: "repositories"` and the `merge` command are additions. Existing
  `local` and `github` configurations behave as before.
- The audit report schema is now `1.1`. It adds the `sources` and `policy`
  fields; everything that was there before is unchanged.
