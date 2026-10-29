// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { aggregatePackages } from './aggregate/aggregate.js';
import { evaluateRelevance } from './discovery/relevance.js';
import { applyCurations, loadCurations } from './enrich/curations.js';
import { normalizeLicenseExpression } from './enrich/license.js';
import { enrichFromNpmRegistry } from './enrich/npm-registry.js';
import { npmExtractor } from './extract/npm.js';
import { createSyftExtractor } from './extract/syft.js';
import { ExtractorUnavailableError, isManifestPath } from './extract/types.js';
import { extractTarGz } from './fetch/tar.js';
import { DATASET_SCHEMA_VERSION } from './model.js';
import { evaluatePolicy } from './policy/policy.js';
import { buildAuditReport } from './report/report.js';
import { mapWithConcurrency } from './util/concurrency.js';
import { errorMessage } from './util/errors.js';
import { log } from './util/log.js';
function buildExtractors(config) {
    return config.extraction.extractors.map((name) => name === 'npm' ? npmExtractor : createSyftExtractor({ syftPath: config.extraction.syftPath, timeoutSeconds: config.extraction.timeoutSeconds }));
}
class ExtractionRunner {
    extractors;
    config;
    warnings;
    unavailable = new Set();
    constructor(extractors, config, warnings) {
        this.extractors = extractors;
        this.config = config;
        this.warnings = warnings;
    }
    async run(rootDir, repository) {
        const handled = new Set(this.extractors.filter((e) => !this.unavailable.has(e.name)).flatMap((e) => e.ecosystems));
        const records = [];
        const used = [];
        for (const extractor of this.extractors) {
            if (this.unavailable.has(extractor.name))
                continue;
            const others = new Set([...handled].filter((ecosystem) => !extractor.ecosystems.includes(ecosystem)));
            try {
                const found = await extractor.extract(rootDir, {
                    includeDevDependencies: this.config.extraction.includeDevDependencies,
                    handledEcosystems: others,
                });
                records.push(...found.map((record) => ({ ...record, repository })));
                used.push(extractor.name);
            }
            catch (error) {
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
async function resolveRepos(config, api) {
    const repos = [];
    const failures = [];
    const failure = (repository, error) => ({
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
            }
            catch (error) {
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
        }
        catch (error) {
            log.error('Could not list repositories', { organization, error: errorMessage(error) });
            failures.push(failure(`${organization}/*`, error));
        }
    }
    return { repos, failures, applyRelevance: true };
}
async function scanGitHub(config, api, runner, now) {
    const { repos, failures: results, applyRelevance } = await resolveRepos(config, api);
    log.info('Discovered repositories', { count: repos.length });
    const records = [];
    const perRepo = await mapWithConcurrency(repos, config.concurrency, async (repo) => {
        const base = { repository: repo.fullName, status: 'excluded', reasons: [], commitSha: null, packageCount: 0, extractors: [], error: null };
        let workDir = null;
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
            if (response.body === null)
                throw new Error('Empty tarball response');
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
        }
        catch (error) {
            log.error('Repository scan failed', { repository: repo.fullName, error: errorMessage(error) });
            return { ...base, status: 'failed', error: errorMessage(error) };
        }
        finally {
            if (workDir !== null)
                await rm(workDir, { recursive: true, force: true });
        }
    });
    return { results: [...results, ...perRepo], records };
}
async function scanLocal(paths, runner) {
    const results = [];
    const records = [];
    // In CI the checkout is the repository, so label the scan with its real name.
    const ciRepository = paths.length === 1 ? process.env.GITHUB_REPOSITORY : undefined;
    for (const path of paths) {
        const repository = ciRepository !== undefined && /^[\w.-]+\/[\w.-]+$/.test(ciRepository) ? ciRepository : basename(path);
        try {
            const { records: found, used } = await runner.run(path, repository);
            records.push(...found);
            results.push({ repository, status: 'scanned', reasons: ['Local path'], commitSha: null, packageCount: found.length, extractors: used, error: null });
        }
        catch (error) {
            results.push({ repository, status: 'failed', reasons: ['Local path'], commitSha: null, packageCount: 0, extractors: [], error: errorMessage(error) });
        }
    }
    return { results, records };
}
/** Collapses identical name@version records found in several repositories. */
function uniqueByVersion(records) {
    const map = new Map();
    for (const record of records) {
        const key = `${record.ecosystem}\u0000${record.name}\u0000${record.version}`;
        const existing = map.get(key);
        if (existing === undefined) {
            map.set(key, { record, repositories: new Set([record.repository]) });
        }
        else {
            existing.repositories.add(record.repository);
            if (existing.record.declaredLicense === undefined && record.declaredLicense !== undefined)
                existing.record = { ...existing.record, declaredLicense: record.declaredLicense };
            if (existing.record.integrity === undefined && record.integrity !== undefined)
                existing.record = { ...existing.record, integrity: record.integrity };
        }
    }
    return [...map.values()].map(({ record, repositories }) => ({ record, repositories: [...repositories].sort() }));
}
async function enrich(items, config, http) {
    return mapWithConcurrency(items, Math.max(config.concurrency * 2, 4), async ({ record, repositories }) => {
        const base = {
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
                const pkg = { name: record.name, version: record.version };
                if (record.integrity !== undefined)
                    pkg.integrity = record.integrity;
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
            }
            catch (error) {
                log.warn('npm registry enrichment failed', { package: record.name, version: record.version, error: errorMessage(error) });
                base.flags.push('ENRICHMENT_FAILED');
            }
        }
        // Fallback for every other ecosystem until more enrichers are available.
        const license = record.declaredLicense !== undefined ? normalizeLicenseExpression(record.declaredLicense) : { expression: null, raw: null, flags: ['LICENSE_UNKNOWN'] };
        const flags = new Set([...base.flags, ...license.flags, 'LICENSE_TEXT_MISSING', 'COPYRIGHT_MISSING']);
        if (base.homepage === null)
            flags.add('HOMEPAGE_MISSING');
        return { ...base, license: { expression: license.expression, raw: license.raw }, flags: [...flags] };
    });
}
export async function runScan(config, deps) {
    const now = deps.now ?? (() => new Date());
    const startedAt = now();
    const warnings = [];
    const runner = new ExtractionRunner(deps.extractors ?? buildExtractors(config), config, warnings);
    let scanned;
    if (config.source.type === 'local') {
        scanned = await scanLocal(config.source.paths, runner);
    }
    else {
        if (deps.github === null)
            throw new Error('A GitHub source is configured but no GitHub client was provided');
        scanned = await scanGitHub(config, deps.github, runner, startedAt);
    }
    const unique = uniqueByVersion(scanned.records);
    log.info('Enriching packages', { versions: unique.length });
    let details = await enrich(unique, config, deps.http);
    if (config.enrichment.curationsFile !== null) {
        const curations = await loadCurations(config.enrichment.curationsFile);
        details = applyCurations(details, curations);
    }
    const packages = aggregatePackages(details);
    const dataset = {
        schemaVersion: DATASET_SCHEMA_VERSION,
        generatedAt: now().toISOString(),
        tool: { name: 'opencredits', version: deps.toolVersion },
        packages,
    };
    const policy = config.policy.enabled ? evaluatePolicy(packages, config.policy) : null;
    const audit = buildAuditReport(startedAt, now(), scanned.results, packages, warnings, policy);
    return { dataset, audit, policy };
}
//# sourceMappingURL=pipeline.js.map