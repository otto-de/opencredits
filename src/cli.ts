#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { realpathSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { mergeDatasets, type NamedDataset } from './aggregate/merge.js';
import { type Config, loadConfig } from './config/config.js';
import { tokenProviderFromEnv } from './github/auth.js';
import { GitHubClient } from './github/client.js';
import { DATASET_SCHEMA_VERSION, type Dataset } from './model.js';
import { runScan } from './pipeline.js';
import { writeSite } from './render/render.js';
import { evaluatePolicy } from './policy/policy.js';
import { auditToMarkdown, buildAuditReport, checkPublishGuard, datasetToSpdx } from './report/report.js';
import { ConfigError, errorMessage } from './util/errors.js';
import { createHttpClient } from './util/http.js';
import { log } from './util/log.js';

export const EXIT = { ok: 0, failure: 1, config: 2, guard: 3, policy: 4 } as const;

const HELP = `OpenCredits: publish an accessible open source license page.

Usage:
  opencredits run      --config <file> --data-dir <dir> --site-dir <dir>
  opencredits scan     --config <file> --data-dir <dir>
  opencredits render   --config <file> --dataset <file> --site-dir <dir>
  opencredits validate --config <file>

Commands:
  run        Scan, check the publish guard and render the page.
  scan       Write dataset.json, sbom.spdx.json, audit-report.json and audit-summary.md.
  render     Render index.html from an existing dataset.
  validate   Check a configuration file and exit.

Options:
  --config     Path to the JSON configuration file (default: opencredits.config.json)
  --data-dir   Private output directory. Never publish it: it names internal repositories.
  --site-dir   Public output directory containing index.html.
  --dataset    Dataset file for "render".
  --help       Show this help.
  --version    Show the version.

Environment:
  OPENCREDITS_GITHUB_APP_ID, OPENCREDITS_GITHUB_APP_PRIVATE_KEY[_PATH]   GitHub App credentials (recommended)
  OPENCREDITS_GITHUB_TOKEN or GITHUB_TOKEN                               Token credentials
  OPENCREDITS_LOG_LEVEL                                                  debug | info | warn | error

Exit codes: 0 success, 1 failure, 2 invalid configuration, 3 publish guard blocked the result.
`;

/** Policy violations are reported after the page is written, so a report is always produced. */
function policyExit(config: Config, dataset: Dataset): number {
  if (!config.policy.enabled) return EXIT.ok;
  return evaluatePolicy(dataset.packages, config.policy).blocking.length > 0 ? EXIT.policy : EXIT.ok;
}

async function toolVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

async function readDataset(path: string): Promise<Dataset> {
  const dataset = JSON.parse(await readFile(path, 'utf8')) as Dataset;
  if (dataset.schemaVersion !== DATASET_SCHEMA_VERSION || !Array.isArray(dataset.packages)) {
    throw new Error(`${path} is not a OpenCredits ${DATASET_SCHEMA_VERSION} dataset`);
  }
  return dataset;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** Collects dataset files from the given files and directories. */
async function readFragments(inputs: readonly string[]): Promise<NamedDataset[]> {
  const paths: string[] = [];
  for (const raw of inputs.flatMap((value) => value.split(',')).map((value) => value.trim()).filter((value) => value !== '')) {
    const path = resolve(raw);
    if ((await stat(path)).isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      paths.push(
        ...entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('audit'))
          .map((entry) => join(path, entry.name))
          .sort(),
      );
    } else {
      paths.push(path);
    }
  }
  if (paths.length === 0) throw new ConfigError(['merge found no dataset files in --inputs']);
  const fragments: NamedDataset[] = [];
  for (const path of paths) fragments.push({ origin: path, dataset: await readDataset(path) });
  return fragments;
}

async function writeOutputs(dataDir: string, dataset: Dataset, audit: ReturnType<typeof buildAuditReport>): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeJson(join(dataDir, 'dataset.json'), dataset);
  await writeJson(join(dataDir, 'sbom.spdx.json'), datasetToSpdx(dataset, 'opencredits-aggregated-dependencies'));
  await writeJson(join(dataDir, 'audit-report.json'), audit);
  const summary = auditToMarkdown(audit);
  await writeFile(join(dataDir, 'audit-summary.md'), summary, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
}

async function scan(config: Config, dataDir: string, version: string): Promise<{ dataset: Dataset; failedRepos: number }> {
  const http = createHttpClient();
  const github = config.source.type === 'github' ? new GitHubClient(config.source.apiUrl, await tokenProviderFromEnv(config.source, http), http, version) : null;
  const { dataset, audit } = await runScan(config, { http, github, toolVersion: version });

  await writeOutputs(dataDir, dataset, audit);
  log.info('Scan finished', audit.summary);
  if (audit.policy !== null && audit.policy.blocking.length > 0) {
    log.error('License policy violations', { blocking: audit.policy.blocking.length });
  }
  return { dataset, failedRepos: audit.summary.repositoriesFailed };
}

function parseCli(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', default: 'opencredits.config.json' },
      'data-dir': { type: 'string', default: 'opencredits-data' },
      'site-dir': { type: 'string', default: 'opencredits-site' },
      dataset: { type: 'string' },
      inputs: { type: 'string', multiple: true },
      help: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
    },
  });
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseCli>;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n\n${HELP}`);
    return EXIT.config;
  }
  const { values, positionals } = parsed;

  const version = await toolVersion();
  if (values.version) {
    process.stdout.write(`${version}\n`);
    return EXIT.ok;
  }
  const command = positionals[0];
  if (values.help || command === undefined) {
    process.stdout.write(HELP);
    return command === undefined && !values.help ? EXIT.config : EXIT.ok;
  }

  try {
    const config = await loadConfig(values.config);
    const dataDir = resolve(values['data-dir']);
    const siteDir = resolve(values['site-dir']);

    switch (command) {
      case 'validate':
        process.stdout.write('Configuration is valid.\n');
        return EXIT.ok;

      case 'scan': {
        const { dataset } = await scan(config, dataDir, version);
        return policyExit(config, dataset);
      }

      case 'merge': {
        if (values.inputs === undefined || values.inputs.length === 0) throw new ConfigError(['merge needs --inputs <paths>']);
        const started = new Date();
        const fragments = await readFragments(values.inputs);
        const { dataset, sources } = mergeDatasets(fragments, version, new Date());
        const policy = config.policy.enabled ? evaluatePolicy(dataset.packages, config.policy) : null;
        const audit = buildAuditReport(started, new Date(), [], dataset.packages, [], policy, sources);
        await writeOutputs(dataDir, dataset, audit);

        const previous = config.guard.previousDatasetPath !== null ? await readDataset(config.guard.previousDatasetPath).catch(() => null) : null;
        const guard = checkPublishGuard(previous, dataset, config.guard.maxPackageDropPercent);
        if (!guard.ok) {
          log.error('Publish guard blocked the result; the page was not rendered', { reason: guard.message });
          return EXIT.guard;
        }
        const target = await writeSite(siteDir, dataset, config.output);
        log.info('Merged datasets and wrote the page', { sources: sources.length, packages: dataset.packages.length, path: target });
        return policyExit(config, dataset);
      }

      case 'render': {
        if (values.dataset === undefined) throw new ConfigError(['render needs --dataset <file>']);
        const target = await writeSite(siteDir, await readDataset(resolve(values.dataset)), config.output);
        log.info('Page written', { path: target });
        return EXIT.ok;
      }

      case 'run': {
        const previous = config.guard.previousDatasetPath !== null ? await readDataset(config.guard.previousDatasetPath).catch(() => null) : null;
        const { dataset } = await scan(config, dataDir, version);
        const guard = checkPublishGuard(previous, dataset, config.guard.maxPackageDropPercent);
        if (!guard.ok) {
          log.error('Publish guard blocked the result; the page was not rendered', { reason: guard.message });
          return EXIT.guard;
        }
        const target = await writeSite(siteDir, dataset, config.output);
        log.info('Page written', { path: target, guard: guard.message });
        return policyExit(config, dataset);
      }

      default:
        process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
        return EXIT.config;
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return EXIT.config;
    }
    log.error('OpenCredits failed', { error: errorMessage(error) });
    return EXIT.failure;
  }
}

function isInvokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    // realpath resolves the symlink npm creates for the "bin" entry.
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

const invokedDirectly = isInvokedDirectly();
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      log.error('Unexpected error', { error: errorMessage(error) });
      process.exitCode = EXIT.failure;
    },
  );
}
