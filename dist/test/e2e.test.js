// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { EXIT, main } from '../src/cli.js';
import { parseConfig } from '../src/config/config.js';
import { StaticTokenProvider } from '../src/github/auth.js';
import { GitHubClient } from '../src/github/client.js';
import { runScan } from '../src/pipeline.js';
import { renderPage } from '../src/render/render.js';
import { createHttpClient } from '../src/util/http.js';
import { buildTarGz, sendJson, startServer } from './helpers.js';
const http = createHttpClient({ backoffBaseMs: 1, retries: 1 });
const SHA_WEB = '1'.repeat(40);
const SHA_APP = '2'.repeat(40);
const TOKEN = 'ghp_e2etoken00000000000000000000000';
function npmTarball(name, license) {
    return buildTarGz([
        { path: 'package/package.json', content: JSON.stringify({ name }) },
        { path: 'package/LICENSE', content: license },
    ]);
}
const packages = {
    react: npmTarball('react', 'MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates.\n\nPermission is hereby granted...'),
    zod: npmTarball('zod', 'MIT License\n\nCopyright (c) 2025 Colin McDonnell\n\nPermission is hereby granted...'),
};
const sri = (data) => `sha512-${createHash('sha512').update(data).digest('base64')}`;
function lockfile(deps) {
    const pkgs = { '': { name: 'app', version: '1.0.0' } };
    for (const [name, entry] of Object.entries(deps))
        pkgs[`node_modules/${name}`] = entry;
    return JSON.stringify({ name: 'app', lockfileVersion: 3, packages: pkgs });
}
describe('end-to-end', () => {
    let server;
    let work;
    before(async () => {
        work = await mkdtemp(join(tmpdir(), 'opencredits-e2e-'));
        const repoArchives = {
            [SHA_WEB]: buildTarGz([
                { path: 'otto-de-shop-web-111/package-lock.json', content: lockfile({ react: { version: '18.3.1', integrity: sri(packages.react) }, eslint: { version: '9.0.0', dev: true } }) },
                { path: 'otto-de-shop-web-111/src/secret.env', content: 'SHOULD_NOT_BE_EXTRACTED=1' },
            ]),
            [SHA_APP]: buildTarGz([
                {
                    path: 'otto-de-checkout-222/web/package-lock.json',
                    content: lockfile({ react: { version: '18.2.0' }, zod: { version: '3.23.8', integrity: sri(packages.zod) } }),
                },
            ]),
        };
        server = await startServer((req, res, url) => {
            const path = url.pathname;
            // npm registry (no auth)
            const manifest = /^\/npm\/(react|zod)\/([\d.]+)$/.exec(path);
            if (manifest !== null) {
                const name = manifest[1];
                return sendJson(res, 200, {
                    license: 'MIT',
                    repository: `github:example/${name}`,
                    dist: { tarball: `${server.url}/npm/${name}/-/${name}.tgz`, integrity: sri(packages[name]) },
                });
            }
            const tgz = /^\/npm\/(react|zod)\/-\//.exec(path);
            if (tgz !== null) {
                res.writeHead(200);
                res.end(packages[tgz[1]]);
                return;
            }
            // GitHub API
            if (req.headers.authorization !== `Bearer ${TOKEN}`)
                return sendJson(res, 401, {});
            if (path === '/orgs/otto-de/repos') {
                return sendJson(res, 200, [
                    { full_name: 'otto-de/shop-web', default_branch: 'main', archived: false, fork: false },
                    { full_name: 'otto-de/checkout', default_branch: 'main', archived: false, fork: false },
                    { full_name: 'otto-de/playground', default_branch: 'main', archived: false, fork: false },
                    { full_name: 'otto-de/legacy', default_branch: 'main', archived: true, fork: false },
                    { full_name: 'otto-de/broken', default_branch: 'main', archived: false, fork: false },
                ]);
            }
            const runs = /^\/repos\/otto-de\/([\w-]+)\/actions\/runs$/.exec(path);
            if (runs !== null) {
                const recent = runs[1] === 'shop-web' || runs[1] === 'broken';
                return sendJson(res, 200, { workflow_runs: recent ? [{ created_at: '2026-09-15T10:00:00Z' }] : [] });
            }
            const commit = /^\/repos\/otto-de\/([\w-]+)\/commits\/main$/.exec(path);
            if (commit !== null) {
                const shas = { 'shop-web': SHA_WEB, checkout: SHA_APP, playground: '3'.repeat(40), broken: '4'.repeat(40) };
                return sendJson(res, 200, { sha: shas[commit[1]] });
            }
            if (path === `/repos/otto-de/checkout/git/trees/${SHA_APP}`) {
                return sendJson(res, 200, { tree: [{ type: 'blob', path: 'helm/values-prod.yaml', sha: '5'.repeat(40), size: 50 }], truncated: false });
            }
            if (path === `/repos/otto-de/playground/git/trees/${'3'.repeat(40)}`) {
                return sendJson(res, 200, { tree: [{ type: 'blob', path: 'README.md', sha: '6'.repeat(40), size: 50 }], truncated: false });
            }
            if (path === `/repos/otto-de/checkout/git/blobs/${'5'.repeat(40)}`) {
                return sendJson(res, 200, { encoding: 'base64', size: 30, content: Buffer.from('ingress:\n  host: checkout.example.com\n').toString('base64') });
            }
            const tarball = /^\/repos\/otto-de\/([\w-]+)\/tarball\/([0-9a-f]{40})$/.exec(path);
            if (tarball !== null) {
                const archive = repoArchives[tarball[2]];
                if (archive === undefined)
                    return sendJson(res, 500, { message: 'boom' });
                res.writeHead(200, { 'content-type': 'application/gzip' });
                res.end(archive);
                return;
            }
            return sendJson(res, 404, {});
        });
    });
    after(async () => {
        await server.close();
        await rm(work, { recursive: true, force: true });
    });
    function githubConfig(extra = {}) {
        return parseConfig({
            source: { type: 'github', apiUrl: server.url, organizations: ['otto-de'], auth: 'token' },
            relevance: { deploymentDomains: ['example.com'] },
            extraction: { extractors: ['npm', 'syft'], syftPath: join(work, 'no-such-syft') },
            enrichment: { npmRegistry: { url: `${server.url}/npm` } },
            ...extra,
        }, work);
    }
    it('scans an organization, filters repositories, deduplicates and isolates failures', async () => {
        const config = githubConfig();
        const github = new GitHubClient(server.url, new StaticTokenProvider(TOKEN), http, 'test');
        const { dataset, audit } = await runScan(config, { http, github, toolVersion: 'test', now: () => new Date('2026-09-16T02:00:00Z') });
        const statuses = Object.fromEntries(audit.repositories.map((repo) => [repo.repository, repo.status]));
        assert.deepEqual(statuses, {
            'otto-de/shop-web': 'scanned',
            'otto-de/checkout': 'scanned',
            'otto-de/playground': 'excluded',
            'otto-de/legacy': 'excluded',
            'otto-de/broken': 'failed',
        });
        assert.match(audit.repositories.find((repo) => repo.repository === 'otto-de/checkout')?.reasons.join(' ') ?? '', /helm\/values-prod\.yaml/);
        assert.ok(audit.warnings.some((warning) => warning.includes('Syft executable not found')), 'missing Syft degrades gracefully');
        assert.deepEqual(dataset.packages.map((pkg) => pkg.name), ['react', 'zod'], 'dev dependencies excluded, react deduplicated');
        const react = dataset.packages[0];
        assert.deepEqual(react?.versions, ['18.2.0', '18.3.1']);
        assert.deepEqual(react?.repositories, ['otto-de/checkout', 'otto-de/shop-web']);
        assert.deepEqual(react?.copyrights, ['Copyright (c) Meta Platforms, Inc. and affiliates.']);
        assert.equal(react?.homepage, 'https://github.com/example/react');
        assert.equal(audit.summary.packagesNeedingReview, 0);
        const { html } = renderPage(dataset, config.output);
        assert.equal(html.includes('otto-de/'), false, 'internal repository names never reach the page');
        assert.equal(html.includes('18.3.1'), false);
        assert.match(html, /Copyright \(c\) 2025 Colin McDonnell/);
    });
    it('runs the CLI in local mode and writes separate private and public outputs', async () => {
        const project = join(work, 'my-app');
        await mkdir(project, { recursive: true });
        await writeFile(join(project, 'package-lock.json'), lockfile({ zod: { version: '3.23.8', integrity: sri(packages.zod) } }));
        const configPath = join(work, 'opencredits.config.json');
        await writeFile(configPath, JSON.stringify({
            source: { type: 'local', paths: ['my-app'] },
            extraction: { extractors: ['npm'] },
            enrichment: { npmRegistry: { url: `${server.url}/npm` } },
            output: { title: 'My app licenses', language: 'en' },
            guard: { previousDatasetPath: 'previous/dataset.json', maxPackageDropPercent: 30 },
        }));
        const dataDir = join(work, 'data');
        const siteDir = join(work, 'site');
        assert.equal(await main(['validate', '--config', configPath]), EXIT.ok);
        assert.equal(await main(['run', '--config', configPath, '--data-dir', dataDir, '--site-dir', siteDir]), EXIT.ok);
        for (const file of ['dataset.json', 'sbom.spdx.json', 'audit-report.json', 'audit-summary.md']) {
            assert.ok(existsSync(join(dataDir, file)), `${file} written`);
        }
        assert.deepEqual((await import('node:fs')).readdirSync(siteDir), ['index.html'], 'public directory holds only the page');
        const page = await readFile(join(siteDir, 'index.html'), 'utf8');
        assert.match(page, /<title>My app licenses<\/title>/);
        assert.match(page, /<h3 id="zod-name">zod<\/h3>/);
        // A later run that suddenly finds nothing must not replace the published page.
        await mkdir(join(work, 'previous'), { recursive: true });
        await writeFile(join(work, 'previous/dataset.json'), await readFile(join(dataDir, 'dataset.json')));
        await writeFile(join(project, 'package-lock.json'), lockfile({}));
        await rm(siteDir, { recursive: true });
        assert.equal(await main(['run', '--config', configPath, '--data-dir', dataDir, '--site-dir', siteDir]), EXIT.guard);
        assert.equal(existsSync(join(siteDir, 'index.html')), false);
    });
    it('returns configuration exit codes for invalid input', async () => {
        const bad = join(work, 'bad.json');
        await writeFile(bad, JSON.stringify({ output: { accentColor: 'red' } }));
        assert.equal(await main(['validate', '--config', bad]), EXIT.config);
        assert.equal(await main(['validate', '--config', join(work, 'missing.json')]), EXIT.config);
        assert.equal(await main(['frobnicate', '--config', bad]), EXIT.config);
        assert.equal(await main(['run', '--unknown-flag']), EXIT.config);
    });
});
//# sourceMappingURL=e2e.test.js.map