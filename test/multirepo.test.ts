// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { aggregatePackages } from '../src/aggregate/aggregate.js';
import { mergeAggregated, mergeDatasets } from '../src/aggregate/merge.js';
import { EXIT, main } from '../src/cli.js';
import { parseConfig } from '../src/config/config.js';
import type { GitHubApi, RepoInfo } from '../src/github/client.js';
import type { AggregatedPackage, Dataset, PackageDetails } from '../src/model.js';
import { runScan } from '../src/pipeline.js';
import { createHttpClient } from '../src/util/http.js';
import { buildTarGz } from './helpers.js';

const http = createHttpClient({ backoffBaseMs: 1, retries: 0 });

function lockfile(deps: Record<string, { version: string; license?: string }>): string {
  const packages: Record<string, unknown> = { '': { name: 'app', version: '1.0.0' } };
  for (const [name, entry] of Object.entries(deps)) packages[`node_modules/${name}`] = entry;
  return JSON.stringify({ name: 'app', lockfileVersion: 3, packages });
}

/** A GitHub API that serves a fixed set of repositories from memory. */
function fakeApi(archives: Record<string, string>): GitHubApi & { relevanceCalls: number } {
  const state = { relevanceCalls: 0 };
  return {
    get relevanceCalls() {
      return state.relevanceCalls;
    },
    listOrganizationRepos: async () => [],
    getRepo: async (fullName: string) => {
      if (!(fullName in archives)) throw new Error(`HTTP 404 for ${fullName}`);
      return {
        fullName,
        organization: fullName.split('/')[0] ?? '',
        defaultBranch: 'main',
        // Explicitly listed repositories are scanned even when archived.
        archived: fullName.endsWith('archived-but-listed'),
        fork: false,
        pushedAt: null,
      };
    },
    getBranchHeadSha: async () => 'a'.repeat(40),
    getLatestSuccessfulRunDate: async () => {
      state.relevanceCalls += 1;
      return null;
    },
    listTree: async () => {
      state.relevanceCalls += 1;
      return { entries: [], truncated: false };
    },
    getBlobText: async () => '',
    downloadTarball: async (repo: RepoInfo) => {
      const content = archives[repo.fullName];
      if (content === undefined) throw new Error('No archive');
      return new Response(buildTarGz([{ path: `prefix/package-lock.json`, content }]), {
        headers: { 'content-type': 'application/gzip' },
      });
    },
  };
}

describe('explicit repository lists', () => {
  const config = parseConfig(
    {
      source: { type: 'repositories', repositories: ['acme/web', 'acme/checkout', 'acme/archived-but-listed', 'acme/missing'], auth: 'token' },
      extraction: { extractors: ['npm'] },
      enrichment: { npmRegistry: { enabled: false } },
    },
    '/tmp',
  );

  it('scans every listed repository without applying the relevance filter', async () => {
    const api = fakeApi({
      'acme/web': lockfile({ react: { version: '18.3.1', license: 'MIT' }, zod: { version: '3.23.8', license: 'MIT' } }),
      'acme/checkout': lockfile({ react: { version: '18.2.0', license: 'MIT' }, 'date-fns': { version: '3.6.0', license: 'MIT' } }),
      'acme/archived-but-listed': lockfile({ clsx: { version: '2.1.1', license: 'MIT' } }),
    });
    const { dataset, audit } = await runScan(config, { http, github: api, toolVersion: 'test' });

    assert.equal(api.relevanceCalls, 0, 'listing a repository is the statement that it is relevant');
    const statuses = Object.fromEntries(audit.repositories.map((repo) => [repo.repository, repo.status]));
    assert.deepEqual(statuses, {
      'acme/web': 'scanned',
      'acme/checkout': 'scanned',
      'acme/archived-but-listed': 'scanned',
      'acme/missing': 'failed',
    });
    assert.deepEqual(audit.repositories.find((repo) => repo.repository === 'acme/web')?.reasons, ['Listed in source.repositories']);

    assert.deepEqual(dataset.packages.map((pkg) => pkg.name), ['clsx', 'date-fns', 'react', 'zod']);
    const react = dataset.packages.find((pkg) => pkg.name === 'react');
    assert.deepEqual(react?.versions, ['18.2.0', '18.3.1'], 'one entry across both repositories');
    assert.deepEqual(react?.repositories, ['acme/checkout', 'acme/web']);
  });

  it('rejects a repositories source with no entries', () => {
    assert.throws(() => parseConfig({ source: { type: 'repositories', repositories: [] } }, '/tmp'), /must list at least one/);
  });
});

function details(name: string, overrides: Partial<PackageDetails> = {}): PackageDetails {
  return {
    name,
    version: '1.0.0',
    ecosystem: 'npm',
    purl: `pkg:npm/${name}@1.0.0`,
    license: { expression: 'MIT', raw: 'MIT' },
    licenseText: null,
    noticeText: null,
    copyrights: [],
    homepage: null,
    repositories: [],
    flags: [],
    ...overrides,
  };
}

function dataset(packages: AggregatedPackage[], generatedAt = '2026-10-01T00:00:00.000Z'): Dataset {
  return { schemaVersion: '1.0', generatedAt, tool: { name: 'test', version: '0' }, packages };
}

describe('merging datasets from separate scans', () => {
  it('combines entries for the same library and keeps the newest details', () => {
    const fromWeb = aggregatePackages([
      details('react', { version: '18.2.0', repositories: ['acme/web'], copyrights: ['Copyright (c) Meta'], flags: ['HOMEPAGE_MISSING'] }),
      details('clsx', { version: '2.1.1', repositories: ['acme/web'] }),
    ]);
    const fromApp = aggregatePackages([
      details('react', {
        version: '18.3.1',
        repositories: ['acme/app'],
        licenseText: 'MIT License (newer copy)',
        homepage: 'https://github.com/facebook/react',
        copyrights: ['Copyright (c) Meta Platforms'],
      }),
    ]);

    const { dataset: merged, sources } = mergeDatasets(
      [
        { origin: 'web.json', dataset: dataset(fromWeb) },
        { origin: 'app.json', dataset: dataset(fromApp, '2026-10-02T00:00:00.000Z') },
      ],
      '0.2.0',
      new Date('2026-10-08T00:00:00.000Z'),
    );

    assert.deepEqual(merged.packages.map((pkg) => pkg.name), ['clsx', 'react']);
    const react = merged.packages.find((pkg) => pkg.name === 'react');
    assert.deepEqual(react?.versions, ['18.2.0', '18.3.1']);
    assert.deepEqual(react?.repositories, ['acme/app', 'acme/web']);
    assert.equal(react?.licenseText, 'MIT License (newer copy)');
    assert.equal(react?.homepage, 'https://github.com/facebook/react');
    assert.deepEqual(react?.copyrights, ['Copyright (c) Meta Platforms', 'Copyright (c) Meta']);
    assert.equal(react?.flags.includes('HOMEPAGE_MISSING'), false, 'a flag resolved by another fragment is dropped');
    assert.deepEqual(sources.map((source) => [source.origin, source.packages]), [['web.json', 2], ['app.json', 1]]);
  });

  it('keeps libraries whose license differs apart, with unique anchors', () => {
    const merged = mergeAggregated([
      ...aggregatePackages([details('lib', { version: '1.0.0' })]),
      ...aggregatePackages([details('lib', { version: '2.0.0', license: { expression: 'Apache-2.0', raw: 'Apache-2.0' } })]),
    ]);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged.map((pkg) => pkg.id).sort(), ['lib-npm-apache-2-0', 'lib-npm-mit']);
  });

  it('is stable when the same dataset is merged twice', () => {
    const once = aggregatePackages([details('react', { repositories: ['acme/web'] })]);
    const twice = mergeAggregated([...once, ...once]);
    assert.equal(twice.length, 1);
    assert.deepEqual(twice[0]?.versions, ['1.0.0']);
    assert.deepEqual(twice[0]?.repositories, ['acme/web']);
  });
});

describe('merge command', () => {
  let work: string;
  before(async () => {
    work = await mkdtemp(join(tmpdir(), 'merge-cli-'));
  });
  after(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it('merges fragment files from a directory and writes one page', async () => {
    const fragments = join(work, 'fragments');
    await mkdir(fragments, { recursive: true });
    await writeFile(
      join(fragments, 'web.json'),
      JSON.stringify(dataset(aggregatePackages([details('react', { repositories: ['acme/web'], licenseText: 'MIT License' })]))),
    );
    await writeFile(
      join(fragments, 'app.json'),
      JSON.stringify(
        dataset(
          aggregatePackages([
            details('react', { version: '18.3.1', repositories: ['acme/app'], licenseText: 'MIT License' }),
            details('gpl-lib', { repositories: ['acme/app'], license: { expression: 'GPL-3.0-only', raw: 'GPL-3.0-only' } }),
          ]),
        ),
      ),
    );
    // An audit report in the same directory must not be read as a fragment.
    await writeFile(join(fragments, 'audit-report.json'), '{"not":"a dataset"}');

    const configPath = join(work, 'config.json');
    await writeFile(configPath, JSON.stringify({ output: { title: 'Acme licenses' }, policy: { failOn: 'forbidden' } }));
    const dataDir = join(work, 'data');
    const siteDir = join(work, 'site');

    const code = await main(['merge', '--config', configPath, '--inputs', fragments, '--data-dir', dataDir, '--site-dir', siteDir]);
    assert.equal(code, EXIT.policy, 'the GPL dependency blocks, but the page is still written');

    const page = await readFile(join(siteDir, 'index.html'), 'utf8');
    assert.match(page, /<h3 id="react-name">react<\/h3>/);
    assert.equal(page.includes('acme/'), false, 'repository names stay private');

    const audit = JSON.parse(await readFile(join(dataDir, 'audit-report.json'), 'utf8')) as {
      sources: { origin: string }[];
      policy: { blocking: { name: string }[] };
    };
    assert.deepEqual(audit.sources.map((source) => source.origin.split('/').pop()), ['app.json', 'web.json']);
    assert.deepEqual(audit.policy.blocking.map((finding) => finding.name), ['gpl-lib']);
    assert.match(await readFile(join(dataDir, 'audit-summary.md'), 'utf8'), /### Merged datasets/);
  });

  it('reports when no inputs are given or nothing matches', async () => {
    const configPath = join(work, 'config.json');
    assert.equal(await main(['merge', '--config', configPath]), EXIT.config);
    const empty = join(work, 'empty');
    await mkdir(empty, { recursive: true });
    assert.equal(await main(['merge', '--config', configPath, '--inputs', empty]), EXIT.config);
    assert.equal(existsSync(join(work, 'site-missing')), false);
  });
});
