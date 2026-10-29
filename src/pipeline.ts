// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { aggregatePackages } from './aggregate/aggregate.js';
import type { Config } from './config/config.js';
import { evaluateRelevance } from './discovery/relevance.js';
import { applyCurations, type Curations, loadCurations } from './enrich/curations.js';
import { normalizeLicenseExpression } from './enrich/license.js';
import { enrichFromNpmRegistry } from './enrich/npm-registry.js';
import { npmExtractor } from './extract/npm.js';
import { createSyftExtractor } from './extract/syft.js';
import { type Extractor, ExtractorUnavailableError, isManifestPath } from './extract/types.js';
import { extractTarGz } from './fetch/tar.js';
import type { GitHubApi, RepoInfo } from './github/client.js';
import { DATASET_SCHEMA_VERSION, type Dataset, type DependencyRecord, type Flag, type PackageDetails } from './model.js';
import { evaluatePolicy, type PolicyResult } from './policy/policy.js';
import { type AuditReport, buildAuditReport, type RepositoryResult } from './report/report.js';
import { mapWithConcurrency } from './util/concurrency.js';
import { errorMessage } from './util/errors.js';
import type { HttpClient } from './util/http.js';
import { log } from './util/log.js';

export interface PipelineDependencies {
  http: HttpClient;
  github: GitHubApi | null;
  toolVersion: string;
  now?: () => Date;
  extractors?: Extractor[];
}

export interface ScanResult {
  dataset: Dataset;
  audit: AuditReport;
  policy: PolicyResult | null;
}

function buildExtractors(config: Config): Extractor[] {
  return config.extraction.extractors.map((name) =>
    name === 'npm' ? npmExtractor : createSyftExtractor({ syftPath: config.extraction.syftPath, timeoutSeconds: config.extraction.timeoutSeconds }),
  );
}

class ExtractionRunner {
  private readonly unavailable = new Set<string>();

  constructor(
    private readonly extractors: Extractor[],
    private readonly config: Config,
    private readonly warnings: string[],
  ) {}

  async run(rootDir: string, repository: string): Promise<{ records: DependencyRecord[]; used: string[] }> {
    const handled = new Set(this.extractors.filter((e) => !this.unavailable.has(e.name)).flatMap((e) => e.ecosystems));
    const records: DependencyRecord[] = [];
    const used: string[] = [];
    for (const extractor of this.extractors) {
      if (this.unavailable.has(extractor.name)) continue;
      const others = new Set([...handled].filter((ecosystem) => !extractor.ecosystems.includes(ecosystem)));
      try {
        const found = await extractor.extract(rootDir, {
          includeDevDependencies: this.config.extraction.includeDevDependencies,
          handledEcosystems: others,
        });
        records.push(...found.map((record) => ({ ...record, repository })));
        used.push(extractor.name);
      } catch (error) {
        if (error instanceof ExtractorUnavailableError) {
          this.unavailable.add(extractor.name);
          const message = `${error.message}. Only the remaining extractors are used for this run.`;
          this.warnings.push(message);
          log.warn(message);
          continue;
        }
        throw error;
      }
    }
    return { records, used };
  }
}

/**
 * Resolves the repositories to scan. An organization source discovers them and
 * applies the relevance filter; an explicit list skips the filter, because
 * listing a repository is itself the statement that it is relevant.
 */
async function resolveRepos(
  config: Config,
  api: GitHubApi,
): Promise<{ repos: RepoInfo[]; failures: RepositoryResult[]; applyRelevance: boolean }> {
  const repos: RepoInfo[] = [];
  const failures: RepositoryResult[] = [];
  const failure = (repository: string, error: unknown): RepositoryResult => ({
    repository,
    status: 'failed',
    reasons: [],
    commitSha: null,
    packageCount: 0,
    extractors: [],
    error: errorMessage(error),
  });

  if (config.source.type === 'repositories') {
    for (const fullName of config.source.repositories) {
      try {
        repos.push(await api.getRepo(fullName));
      } catch (error) {
        log.error('Could not read repository', { repository: fullName, error: errorMessage(error) });
        failures.push(failure(fullName, error));
      }
    }
    return { repos, failures, applyRelevance: false };
  }

  const organizations = config.source.type === 'github' ? config.source.organizations : [];
  for (const organization of organizations) {
    try {
      repos.push(...(await api.listOrganizationRepos(organization)));
    } catch (error) {
      log.error('Could not list repositories', { organization, error: errorMessage(error) });
      failures.push(failure(`${organization}/*`, error));
    }
  }
  return { repos, failures, applyRelevance: true };
}

async function scanGitHub(
  config: Config,
  api: GitHubApi,
  runner: ExtractionRunner,
  now: Date,
): Promise<{ results: RepositoryResult[]; records: DependencyRecord[] }> {
  const { repos, failures: results, applyRelevance } = await resolveRepos(config, api);
  log.info('Discovered repositories', { count: repos.length });

  const records: DependencyRecord[] = [];
  const perRepo = await mapWithConcurrency(repos, config.concurrency, async (repo): Promise<RepositoryResult> => {
    const base: RepositoryResult = { repository: repo.fullName, status: 'excluded', reasons: [], commitSha: null, packageCount: 0, extractors: [], error: null };
    let workDir: string | null = null;
    try {
      const decision = applyRelevance
        ? await evaluateRelevance(repo, api, config.relevance, now)
        : { relevant: true, reasons: ['Listed in source.repositories'], headSha: await api.getBranchHeadSha(repo) };
      base.reasons = decision.reasons;
      if (!decision.relevant || decision.headSha === null) {
        log.info('Repository excluded', { repository: repo.fullName, reasons: decision.reasons });
        return base;
      }
      base.commitSha = decision.headSha;

      workDir = await mkdtemp(join(tmpdir(), 'opencredits-'));
      const response = await api.downloadTarball(repo, decision.headSha);
      if (response.body === null) throw new Error('Empty tarball response');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > config.extraction.maxArchiveBytes) {
        await response.body.cancel();
        throw new Error(`Archive larger than ${config.extraction.maxArchiveBytes} bytes`);
      }
      const extracted = await extractTarGz(Readable.fromWeb(response.body), workDir, {
        stripComponents: 1,
        maxEntryBytes: 100 * 1024 * 1024,
        maxTotalBytes: config.extraction.maxExtractedBytes,
        maxEntries: 500_000,
        maxStreamBytes: config.extraction.maxExtractedBytes * 2,
        ...(config.extraction.mode === 'manifests' ? { filter: isManifestPath } : {}),
      });
      log.debug('Extracted archive', { repository: repo.fullName, files: extracted.files, skipped: extracted.skipped.length });

      const { records: found, used } = await runner.run(workDir, repo.fullName);
      records.push(...found);
      log.info('Repository scanned', { repository: repo.fullName, packages: found.length });
      return { ...base, status: 'scanned', packageCount: found.length, extractors: used };
    } catch (error) {
      log.error('Repository scan failed', { repository: repo.fullName, error: errorMessage(error) });
      return { ...base, status: 'failed', error: errorMessage(error) };
    } finally {
      if (workDir !== null) await rm(workDir, { recursive: true, force: true });
    }
  });
  return { results: [...results, ...perRepo], records };
}

async function scanLocal(paths: string[], runner: ExtractionRunner): Promise<{ results: RepositoryResult[]; records: DependencyRecord[] }> {
  const results: RepositoryResult[] = [];
  const records: DependencyRecord[] = [];
  // In CI the checkout is the repository, so label the scan with its real name.
  const ciRepository = paths.length === 1 ? process.env.GITHUB_REPOSITORY : undefined;
  for (const path of paths) {
    const repository = ciRepository !== undefined && /^[\w.-]+\/[\w.-]+$/.test(ciRepository) ? ciRepository : basename(path);
    try {
      const { records: found, used } = await runner.run(path, repository);
      records.push(...found);
      results.push({ repository, status: 'scanned', reasons: ['Local path'], commitSha: null, packageCount: found.length, extractors: used, error: null });
    } catch (error) {
      results.push({ repository, status: 'failed', reasons: ['Local path'], commitSha: null, packageCount: 0, extractors: [], error: errorMessage(error) });
    }
  }
  return { results, records };
}

/** Collapses identical name@version records found in several repositories. */
function uniqueByVersion(records: DependencyRecord[]): { record: DependencyRecord; repositories: string[] }[] {
  const map = new Map<string, { record: DependencyRecord; repositories: Set<string> }>();
  for (const record of records) {
    const key = `${record.ecosystem}\u0000${record.name}\u0000${record.version}`;
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, { record, repositories: new Set([record.repository]) });
    } else {
      existing.repositories.add(record.repository);
      if (existing.record.declaredLicense === undefined && record.declaredLicense !== undefined) existing.record = { ...existing.record, declaredLicense: record.declaredLicense };
      if (existing.record.integrity === undefined && record.integrity !== undefined) existing.record = { ...existing.record, integrity: record.integrity };
    }
  }
  return [...map.values()].map(({ record, repositories }) => ({ record, repositories: [...repositories].sort() }));
}

async function enrich(
  items: { record: DependencyRecord; repositories: string[] }[],
  config: Config,
  http: HttpClient,
): Promise<PackageDetails[]> {
  return mapWithConcurrency(items, Math.max(config.concurrency * 2, 4), async ({ record, repositories }) => {
    const base: PackageDetails = {
      name: record.name,
      version: record.version,
      ecosystem: record.ecosystem,
      purl: record.purl,
      license: { expression: null, raw: null },
      licenseText: null,
      noticeText: null,
      copyrights: [],
      homepage: record.homepage ?? null,
      repositories,
      flags: [],
    };

    if (record.ecosystem === 'npm' && config.enrichment.npmRegistry.enabled) {
      try {
        const pkg: { name: string; version: string; integrity?: string } = { name: record.name, version: record.version };
        if (record.integrity !== undefined) pkg.integrity = record.integrity;
        const result = await enrichFromNpmRegistry(pkg, config.enrichment.npmRegistry, http, { stripEmails: config.output.stripEmails });
        return {
          ...base,
          license: { expression: result.license.expression, raw: result.license.raw },
          licenseText: result.licenseText,
          noticeText: result.noticeText,
          copyrights: result.copyrights,
          homepage: result.homepage ?? base.homepage,
          flags: result.flags,
        };
      } catch (error) {
        log.warn('npm registry enrichment failed', { package: record.name, version: record.version, error: errorMessage(error) });
        base.flags.push('ENRICHMENT_FAILED');
      }
    }

    // Fallback for every other ecosystem until more enrichers are available.
    const license = record.declaredLicense !== undefined ? normalizeLicenseExpression(record.declaredLicense) : { expression: null, raw: null, flags: ['LICENSE_UNKNOWN'] as Flag[] };
    const flags = new Set<Flag>([...base.flags, ...license.flags, 'LICENSE_TEXT_MISSING', 'COPYRIGHT_MISSING']);
    if (base.homepage === null) flags.add('HOMEPAGE_MISSING');
    return { ...base, license: { expression: license.expression, raw: license.raw }, flags: [...flags] };
  });
}

export async function runScan(config: Config, deps: PipelineDependencies): Promise<ScanResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const warnings: string[] = [];
  const runner = new ExtractionRunner(deps.extractors ?? buildExtractors(config), config, warnings);

  let scanned: { results: RepositoryResult[]; records: DependencyRecord[] };
  if (config.source.type === 'local') {
    scanned = await scanLocal(config.source.paths, runner);
  } else {
    if (deps.github === null) throw new Error('A GitHub source is configured but no GitHub client was provided');
    scanned = await scanGitHub(config, deps.github, runner, startedAt);
  }

  const unique = uniqueByVersion(scanned.records);
  log.info('Enriching packages', { versions: unique.length });
  let details = await enrich(unique, config, deps.http);

  if (config.enrichment.curationsFile !== null) {
    const curations: Curations = await loadCurations(config.enrichment.curationsFile);
    details = applyCurations(details, curations);
  }

  const packages = aggregatePackages(details);
  const dataset: Dataset = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    generatedAt: now().toISOString(),
    tool: { name: 'opencredits', version: deps.toolVersion },
    packages,
  };
  const policy = config.policy.enabled ? evaluatePolicy(packages, config.policy) : null;
  const audit = buildAuditReport(startedAt, now(), scanned.results, packages, warnings, policy);
  return { dataset, audit, policy };
}
