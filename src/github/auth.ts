// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { GitHubSource, RepositoriesSource } from '../config/config.js';
import { ConfigError } from '../util/errors.js';
import { expectOk, type HttpClient, readJsonLimited } from '../util/http.js';
import { registerSecret } from '../util/log.js';

export interface TokenProvider {
  tokenFor(organization: string): Promise<string>;
}

export class StaticTokenProvider implements TokenProvider {
  constructor(private readonly token: string) {
    registerSecret(token);
  }

  tokenFor(): Promise<string> {
    return Promise.resolve(this.token);
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Issues short-lived, read-only installation tokens for a GitHub App.
 * Tokens are down-scoped to the permissions OpenCredits needs, even if the
 * App installation was granted more.
 */
export class GitHubAppTokenProvider implements TokenProvider {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly apiUrl: string,
    private readonly appId: string,
    private readonly privateKeyPem: string,
    private readonly http: HttpClient,
    private readonly now: () => number = Date.now,
  ) {
    registerSecret(privateKeyPem);
  }

  createJwt(): string {
    const issuedAt = Math.floor(this.now() / 1000) - 60;
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: this.appId }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    return `${header}.${payload}.${base64url(signer.sign(this.privateKeyPem))}`;
  }

  async tokenFor(organization: string): Promise<string> {
    const cached = this.cache.get(organization);
    if (cached !== undefined && cached.expiresAt - this.now() > 5 * 60_000) return cached.token;

    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.createJwt()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'opencredits',
    };
    const installation = (await readJsonLimited(
      await expectOk(await this.http.request(`${this.apiUrl}/orgs/${encodeURIComponent(organization)}/installation`, { headers })),
      1024 * 1024,
    )) as { id?: unknown };
    if (typeof installation.id !== 'number') throw new Error(`No GitHub App installation found for ${organization}`);

    const response = await this.http.request(`${this.apiUrl}/app/installations/${installation.id}/access_tokens`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: { contents: 'read', metadata: 'read', actions: 'read' } }),
    });
    const body = (await readJsonLimited(await expectOk(response), 1024 * 1024)) as { token?: unknown; expires_at?: unknown };
    if (typeof body.token !== 'string' || typeof body.expires_at !== 'string') {
      throw new Error('GitHub returned an unexpected installation token response');
    }
    registerSecret(body.token);
    this.cache.set(organization, { token: body.token, expiresAt: Date.parse(body.expires_at) });
    return body.token;
  }
}

export async function tokenProviderFromEnv(
  source: GitHubSource | RepositoriesSource,
  http: HttpClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TokenProvider> {
  if (source.auth === 'token') {
    const token = env.OPENCREDITS_GITHUB_TOKEN ?? env.GITHUB_TOKEN;
    if (token === undefined || token === '') {
      throw new ConfigError(['source.auth is "token" but neither OPENCREDITS_GITHUB_TOKEN nor GITHUB_TOKEN is set']);
    }
    return new StaticTokenProvider(token);
  }

  const appId = env.OPENCREDITS_GITHUB_APP_ID;
  let privateKey = env.OPENCREDITS_GITHUB_APP_PRIVATE_KEY;
  if ((privateKey === undefined || privateKey === '') && env.OPENCREDITS_GITHUB_APP_PRIVATE_KEY_PATH !== undefined) {
    privateKey = await readFile(env.OPENCREDITS_GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
  }
  if (appId === undefined || !/^\d+$/.test(appId) || privateKey === undefined || privateKey === '') {
    throw new ConfigError([
      'source.auth is "app" but OPENCREDITS_GITHUB_APP_ID and OPENCREDITS_GITHUB_APP_PRIVATE_KEY (or OPENCREDITS_GITHUB_APP_PRIVATE_KEY_PATH) are not both set',
    ]);
  }
  return new GitHubAppTokenProvider(source.apiUrl, appId, privateKey, http);
}
