// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import { SafetyLimitError } from '../util/errors.js';
import { expectOk, HttpError, readJsonLimited } from '../util/http.js';
const JSON_LIMIT = 50 * 1024 * 1024;
const FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
function repoPath(repo) {
    if (!FULL_NAME.test(repo.fullName))
        throw new Error(`Refusing unexpected repository name ${JSON.stringify(repo.fullName)}`);
    const [owner, name] = repo.fullName.split('/');
    return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}
function assertSha(sha) {
    if (!GIT_SHA.test(sha))
        throw new Error(`Refusing unexpected git SHA ${JSON.stringify(sha)}`);
    return sha;
}
function nextLink(linkHeader) {
    if (linkHeader === null)
        return null;
    for (const part of linkHeader.split(',')) {
        const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
        if (match?.[1] !== undefined)
            return match[1];
    }
    return null;
}
export class GitHubClient {
    apiUrl;
    tokens;
    http;
    version;
    origin;
    constructor(apiUrl, tokens, http, version) {
        this.apiUrl = apiUrl;
        this.tokens = tokens;
        this.http = http;
        this.version = version;
        this.origin = new URL(apiUrl).origin;
    }
    async headers(organization) {
        return {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${await this.tokens.tokenFor(organization)}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': `opencredits/${this.version}`,
        };
    }
    async getJson(url, organization) {
        // Never send credentials to a host other than the configured API.
        if (new URL(url).origin !== this.origin)
            throw new Error(`Refusing to call unexpected host for ${url}`);
        const response = await this.http.request(url, { headers: await this.headers(organization) });
        return readJsonLimited(await expectOk(response), JSON_LIMIT);
    }
    async listOrganizationRepos(organization) {
        const repos = [];
        let url = `${this.apiUrl}/orgs/${encodeURIComponent(organization)}/repos?type=all&per_page=100`;
        while (url !== null) {
            if (new URL(url).origin !== this.origin)
                throw new Error('Pagination link points to an unexpected host');
            const response = await this.http.request(url, { headers: await this.headers(organization) });
            const page = (await readJsonLimited(await expectOk(response), JSON_LIMIT));
            if (!Array.isArray(page))
                throw new Error('Unexpected response when listing repositories');
            for (const item of page) {
                if (typeof item.full_name !== 'string' || typeof item.default_branch !== 'string')
                    continue;
                repos.push({
                    fullName: item.full_name,
                    organization,
                    defaultBranch: item.default_branch,
                    archived: item.archived === true,
                    fork: item.fork === true,
                    pushedAt: typeof item.pushed_at === 'string' ? item.pushed_at : null,
                });
            }
            url = nextLink(response.headers.get('link'));
        }
        return repos;
    }
    async getRepo(fullName) {
        if (!FULL_NAME.test(fullName))
            throw new Error(`Refusing unexpected repository name ${JSON.stringify(fullName)}`);
        const [owner, name] = fullName.split('/');
        const body = (await this.getJson(`${this.apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, owner));
        if (typeof body.full_name !== 'string' || typeof body.default_branch !== 'string') {
            throw new Error(`Could not read repository ${fullName}`);
        }
        return {
            fullName: body.full_name,
            organization: owner,
            defaultBranch: body.default_branch,
            archived: body.archived === true,
            fork: body.fork === true,
            pushedAt: typeof body.pushed_at === 'string' ? body.pushed_at : null,
        };
    }
    async getBranchHeadSha(repo) {
        const body = (await this.getJson(`${this.apiUrl}/repos/${repoPath(repo)}/commits/${encodeURIComponent(repo.defaultBranch)}`, repo.organization));
        if (typeof body.sha !== 'string')
            throw new Error(`Could not resolve head commit of ${repo.fullName}`);
        return assertSha(body.sha);
    }
    async getLatestSuccessfulRunDate(repo) {
        const query = new URLSearchParams({
            branch: repo.defaultBranch,
            status: 'success',
            per_page: '1',
            exclude_pull_requests: 'true',
        });
        try {
            const body = (await this.getJson(`${this.apiUrl}/repos/${repoPath(repo)}/actions/runs?${query}`, repo.organization));
            const created = body.workflow_runs?.[0]?.created_at;
            return typeof created === 'string' ? new Date(created) : null;
        }
        catch (error) {
            // Actions disabled or not available for this repository.
            if (error instanceof HttpError && (error.status === 404 || error.status === 403))
                return null;
            throw error;
        }
    }
    async listTree(repo, sha) {
        const body = (await this.getJson(`${this.apiUrl}/repos/${repoPath(repo)}/git/trees/${assertSha(sha)}?recursive=1`, repo.organization));
        const entries = [];
        for (const item of body.tree ?? []) {
            if (item.type === 'blob' && typeof item.path === 'string' && typeof item.sha === 'string') {
                entries.push({ path: item.path, sha: item.sha, size: typeof item.size === 'number' ? item.size : 0 });
            }
        }
        return { entries, truncated: body.truncated === true };
    }
    async getBlobText(repo, blobSha, maxBytes) {
        const body = (await this.getJson(`${this.apiUrl}/repos/${repoPath(repo)}/git/blobs/${assertSha(blobSha)}`, repo.organization));
        if (typeof body.size === 'number' && body.size > maxBytes)
            throw new SafetyLimitError(`Blob larger than ${maxBytes} bytes`);
        if (typeof body.content !== 'string')
            return '';
        return body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : body.content;
    }
    async downloadTarball(repo, sha) {
        const response = await this.http.request(`${this.apiUrl}/repos/${repoPath(repo)}/tarball/${assertSha(sha)}`, {
            headers: await this.headers(repo.organization),
            timeoutMs: 10 * 60_000,
        });
        return expectOk(response);
    }
}
//# sourceMappingURL=client.js.map