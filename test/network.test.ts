// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { parseConfig } from '../src/config/config.js';
import { domainPattern, evaluateRelevance } from '../src/discovery/relevance.js';
import { enrichFromNpmRegistry, parseIntegrity, verifyIntegrity } from '../src/enrich/npm-registry.js';
import { GitHubAppTokenProvider, StaticTokenProvider, tokenProviderFromEnv } from '../src/github/auth.js';
import { GitHubClient, type GitHubApi, type RepoInfo } from '../src/github/client.js';
import { createHttpClient, readBodyLimited } from '../src/util/http.js';
import { redact, registerSecret } from '../src/util/log.js';
import { buildTarGz, sendJson, startServer } from './helpers.js';

const fastHttp = createHttpClient({ backoffBaseMs: 1, retries: 2, maxRateLimitWaitMs: 5_000 });
const SHA = 'a'.repeat(40);

describe('HTTP client', () => {
  it('retries server errors and honours retry-after', async () => {
    let calls = 0;
    const server = await startServer((_req, res) => {
      calls += 1;
      if (calls === 1) return sendJson(res, 503, {});
      if (calls === 2) return sendJson(res, 429, {}, { 'retry-after': '0' });
      return sendJson(res, 200, { ok: true });
    });
    try {
      const response = await fastHttp.request(`${server.url}/x`);
      assert.equal(response.status, 200);
      assert.equal(calls, 3);
      await response.body?.cancel();
    } finally {
      await server.close();
    }
  });

  it('gives up when a rate limit reset is too far away', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const server = await startServer((_req, res) =>
      sendJson(res, 403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }),
    );
    try {
      await assert.rejects(fastHttp.request(`${server.url}/x`), /HTTP 403/);
    } finally {
      await server.close();
    }
  });

  it('aborts bodies above the size limit', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('x'.repeat(10_000));
    });
    try {
      await assert.rejects(readBodyLimited(await fastHttp.request(server.url), 1000), /larger than 1000 bytes/);
    } finally {
      await server.close();
    }
  });
});

describe('secret redaction', () => {
  it('masks registered secrets and GitHub token formats', () => {
    registerSecret('super-secret-value');
    const text = redact('token super-secret-value and ghs_abcdefghijklmnopqrstuvwxyz0123');
    assert.equal(text, 'token *** and ***');
  });
});

describe('GitHub authentication', () => {
  it('signs a valid RS256 JWT and requests down-scoped installation tokens', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    let requestedPermissions: unknown;
    const server = await startServer(async (req, res, url) => {
      const auth = req.headers.authorization ?? '';
      const [header, payload, signature] = auth.replace('Bearer ', '').split('.');
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${header}.${payload}`);
      if (!verifier.verify(publicKey, Buffer.from(signature ?? '', 'base64url'))) return sendJson(res, 401, {});
      if (url.pathname === '/orgs/otto-de/installation') return sendJson(res, 200, { id: 42 });
      if (url.pathname === '/app/installations/42/access_tokens' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += String(chunk);
        requestedPermissions = (JSON.parse(body) as { permissions: unknown }).permissions;
        return sendJson(res, 201, { token: 'ghs_installationtoken000000000000', expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      return sendJson(res, 404, {});
    });
    try {
      const provider = new GitHubAppTokenProvider(server.url, '12345', pem, fastHttp);
      const payload = JSON.parse(Buffer.from(provider.createJwt().split('.')[1] ?? '', 'base64url').toString()) as { iss: string; exp: number; iat: number };
      assert.equal(payload.iss, '12345');
      assert.ok(payload.exp - payload.iat <= 600, 'GitHub rejects JWTs valid for more than 10 minutes');

      assert.equal(await provider.tokenFor('otto-de'), 'ghs_installationtoken000000000000');
      assert.deepEqual(requestedPermissions, { contents: 'read', metadata: 'read', actions: 'read' });
      await provider.tokenFor('otto-de');
      assert.equal(server.requests.length, 2, 'tokens are cached until close to expiry');
    } finally {
      await server.close();
    }
  });

  it('explains missing credentials', async () => {
    const source = { type: 'github' as const, apiUrl: 'https://api.github.com', organizations: ['x'], auth: 'app' as const };
    await assert.rejects(tokenProviderFromEnv(source, fastHttp, {}), /OPENCREDITS_GITHUB_APP_ID/);
    await assert.rejects(tokenProviderFromEnv({ ...source, auth: 'token' }, fastHttp, {}), /GITHUB_TOKEN/);
  });
});

describe('GitHubClient', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let client: GitHubClient;

  before(async () => {
    server = await startServer((req, res, url) => {
      if (req.headers.authorization !== 'Bearer ghp_testtoken0000000000000000000000') return sendJson(res, 401, {});
      if (url.pathname === '/orgs/acme/repos') {
        const page = url.searchParams.get('page');
        if (page === null) {
          return sendJson(res, 200, [{ full_name: 'acme/web', default_branch: 'main', archived: false, fork: false, pushed_at: '2026-09-01T00:00:00Z' }], {
            link: `<${server.url}/orgs/acme/repos?page=2>; rel="next"`,
          });
        }
        return sendJson(res, 200, [{ full_name: 'acme/old', default_branch: 'master', archived: true, fork: false }]);
      }
      if (url.pathname === '/orgs/evil/repos') {
        return sendJson(res, 200, [], { link: '<https://attacker.example/steal>; rel="next"' });
      }
      if (url.pathname === '/repos/acme/web/actions/runs') return sendJson(res, 404, {});
      return sendJson(res, 404, {});
    });
    client = new GitHubClient(server.url, new StaticTokenProvider('ghp_testtoken0000000000000000000000'), fastHttp, '0.1.0');
  });
  after(() => server.close());

  it('follows pagination', async () => {
    const repos = await client.listOrganizationRepos('acme');
    assert.deepEqual(repos.map((repo) => [repo.fullName, repo.archived]), [['acme/web', false], ['acme/old', true]]);
  });

  it('refuses pagination links to other hosts so the token cannot leak', async () => {
    await assert.rejects(client.listOrganizationRepos('evil'), /unexpected host/);
  });

  it('treats disabled Actions as no CI run', async () => {
    const repo: RepoInfo = { fullName: 'acme/web', organization: 'acme', defaultBranch: 'main', archived: false, fork: false, pushedAt: null };
    assert.equal(await client.getLatestSuccessfulRunDate(repo), null);
  });

  it('rejects unexpected repository names and SHAs', async () => {
    const repo: RepoInfo = { fullName: '../../admin', organization: 'acme', defaultBranch: 'main', archived: false, fork: false, pushedAt: null };
    await assert.rejects(client.getBranchHeadSha(repo), /unexpected repository name/);
    await assert.rejects(client.listTree({ ...repo, fullName: 'acme/web' }, 'main; rm -rf'), /unexpected git SHA/);
  });
});

function fakeApi(overrides: Partial<GitHubApi> & { files?: Record<string, string> } = {}): GitHubApi & { calls: string[] } {
  const calls: string[] = [];
  const files = overrides.files ?? {};
  return {
    calls,
    listOrganizationRepos: async () => [],
    getRepo: async (fullName: string) => ({ fullName, organization: fullName.split('/')[0] ?? '', defaultBranch: 'main', archived: false, fork: false, pushedAt: null }),
    getBranchHeadSha: async () => {
      calls.push('head');
      return SHA;
    },
    getLatestSuccessfulRunDate: async () => {
      calls.push('runs');
      return null;
    },
    listTree: async () => ({
      entries: Object.keys(files).map((path, index) => ({ path, sha: String(index).padStart(40, '0'), size: 100 })),
      truncated: false,
    }),
    getBlobText: async (_repo, sha) => Object.values(files)[Number(sha)] ?? '',
    downloadTarball: async () => {
      throw new Error('not used');
    },
    ...overrides,
  };
}

describe('evaluateRelevance', () => {
  const repo: RepoInfo = { fullName: 'otto-de/shop-web', organization: 'otto-de', defaultBranch: 'main', archived: false, fork: false, pushedAt: null };
  const base = parseConfig({ relevance: { deploymentDomains: ['example.com'] } }, '/tmp').relevance;
  const now = new Date('2026-09-16T00:00:00Z');

  it('includes repositories with a recent successful CI run', async () => {
    const api = fakeApi({ getLatestSuccessfulRunDate: async () => new Date('2026-09-10T00:00:00Z') });
    const decision = await evaluateRelevance(repo, api, base, now);
    assert.equal(decision.relevant, true);
    assert.equal(decision.headSha, SHA);
    assert.match(decision.reasons[0] ?? '', /Successful CI run/);
  });

  it('includes repositories whose deployment config references a configured domain', async () => {
    const api = fakeApi({
      getLatestSuccessfulRunDate: async () => new Date('2025-01-01T00:00:00Z'),
      files: { 'src/app.ts': 'example.com', 'deploy/k8s/ingress.yaml': 'host: www.example.com\n' },
    });
    const decision = await evaluateRelevance(repo, api, base, now);
    assert.equal(decision.relevant, true);
    assert.match(decision.reasons.at(-1) ?? '', /deploy\/k8s\/ingress\.yaml/);
  });

  it('excludes playgrounds and explains why', async () => {
    const api = fakeApi({ files: { 'terraform/main.tf': 'domain = "example.com.evil.net"\nbucket = "notexample.com"' } });
    const decision = await evaluateRelevance(repo, api, base, now);
    assert.equal(decision.relevant, false);
    assert.deepEqual(decision.reasons, [
      'No successful CI run found on the default branch',
      'None of 1 deployment configuration files reference a configured domain',
    ]);
  });

  it('applies denylist, allowlist, archive and fork rules before any API call', async () => {
    const api = fakeApi();
    assert.equal((await evaluateRelevance({ ...repo, archived: true }, api, base, now)).relevant, false);
    assert.equal((await evaluateRelevance({ ...repo, fork: true }, api, base, now)).relevant, false);
    assert.equal(api.calls.length, 0);
    const allow = await evaluateRelevance({ ...repo, archived: true }, api, { ...base, allowlist: ['OTTO-DE/shop-web'] }, now);
    assert.equal(allow.relevant, true, 'allowlist is a case-insensitive override');
    const deny = await evaluateRelevance(repo, api, { ...base, allowlist: ['otto-de/shop-web'], denylist: ['otto-de/shop-web'] }, now);
    assert.equal(deny.relevant, false, 'denylist wins over allowlist');
  });

  it('matches domains and subdomains only', () => {
    const pattern = domainPattern(['example.com']);
    assert.ok(pattern?.test('https://api.example.com/x'));
    assert.ok(pattern?.test('host: example.com'));
    assert.equal(pattern?.test('notexample.com'), false);
    assert.equal(pattern?.test('example.community'), false);
    assert.equal(domainPattern([]), null);
  });
});

describe('npm registry enrichment', () => {
  const licenseText = 'MIT License\r\n\r\nCopyright (c) 2013-present, Example Authors <team@example.com>\r\n\r\nPermission is hereby granted...';
  const tarball = buildTarGz([
    { path: 'package/package.json', content: '{"name":"left-pad"}' },
    { path: 'package/LICENSE', content: licenseText },
    { path: 'package/docs/LICENSE', content: 'should be ignored' },
  ]);
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  let server: Awaited<ReturnType<typeof startServer>>;
  let config: ReturnType<typeof parseConfig>['enrichment']['npmRegistry'];

  before(async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === '/left-pad/1.3.0' || url.pathname === '/@scope%2Fwidget/2.0.0') {
        return sendJson(res, 200, {
          license: 'mit',
          repository: { type: 'git', url: 'git+https://github.com/example/left-pad.git' },
          author: { name: 'Example Author', email: 'a@example.com' },
          dist: { tarball: `${server.url}/left-pad/-/left-pad-1.3.0.tgz`, integrity },
        });
      }
      if (url.pathname === '/offsite/1.0.0') {
        return sendJson(res, 200, { license: 'ISC', dist: { tarball: 'https://attacker.example/x.tgz', integrity } });
      }
      if (url.pathname === '/left-pad/-/left-pad-1.3.0.tgz') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(tarball);
        return;
      }
      return sendJson(res, 404, {});
    });
    config = parseConfig({ enrichment: { npmRegistry: { url: server.url } } }, '/tmp').enrichment.npmRegistry;
  });
  after(() => server.close());

  it('reads the verbatim license file after verifying integrity', async () => {
    const result = await enrichFromNpmRegistry({ name: 'left-pad', version: '1.3.0', integrity }, config, fastHttp, { stripEmails: true });
    assert.equal(result.license.expression, 'MIT');
    assert.equal(result.licenseText?.includes('\r'), false);
    assert.match(result.licenseText ?? '', /^MIT License\n\nCopyright/);
    assert.deepEqual(result.copyrights, ['Copyright (c) 2013-present, Example Authors']);
    assert.equal(result.homepage, 'https://github.com/example/left-pad');
    assert.deepEqual(result.flags, []);
  });

  it('encodes scoped package names', async () => {
    const result = await enrichFromNpmRegistry({ name: '@scope/widget', version: '2.0.0' }, config, fastHttp, { stripEmails: true });
    assert.equal(result.license.expression, 'MIT');
  });

  it('discards tarball content when the lockfile checksum does not match', async () => {
    const wrong = `sha512-${createHash('sha512').update('tampered').digest('base64')}`;
    const result = await enrichFromNpmRegistry({ name: 'left-pad', version: '1.3.0', integrity: wrong }, config, fastHttp, { stripEmails: true });
    assert.equal(result.licenseText, null);
    assert.ok(result.flags.includes('INTEGRITY_UNVERIFIED'));
    assert.deepEqual(result.copyrights, ['Example Author'], 'falls back to the author field');
    assert.ok(result.flags.includes('COPYRIGHT_INFERRED_FROM_AUTHOR'));
  });

  it('does not download tarballs from hosts that are not allowed', async () => {
    const before = server.requests.length;
    const result = await enrichFromNpmRegistry({ name: 'offsite', version: '1.0.0' }, config, fastHttp, { stripEmails: true });
    assert.equal(server.requests.length, before + 1, 'only the manifest was requested');
    assert.ok(result.flags.includes('LICENSE_TEXT_MISSING'));
  });

  it('parses and verifies integrity strings, preferring the strongest algorithm', () => {
    const data = Buffer.from('hello');
    const sha1 = `sha1-${createHash('sha1').update(data).digest('base64')}`;
    const sha512 = `sha512-${createHash('sha512').update(data).digest('base64')}`;
    assert.equal(parseIntegrity(`${sha1} ${sha512}`)?.algorithm, 'sha512');
    assert.equal(verifyIntegrity(data, sha512), true);
    assert.equal(verifyIntegrity(data, 'md5-abc'), false);
  });
});
