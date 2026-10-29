// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Returns an http(s) URL without credentials, or null. Any other scheme
 * (javascript:, data:, file:, ...) is rejected because the URL is rendered
 * as a link on a public page.
 */
export function toSafeHttpUrl(value) {
    if (typeof value !== 'string' || value.length > 2048)
        return null;
    let url;
    try {
        url = new URL(value.trim());
    }
    catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return null;
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
}
const SHORTHAND = /^(github|gitlab|bitbucket):([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/;
const HOSTS = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' };
/** Converts package.json "repository" values into a browsable https URL. */
export function repositoryUrl(repository) {
    let raw = repository;
    if (typeof repository === 'object' && repository !== null)
        raw = repository.url;
    if (typeof raw !== 'string')
        return null;
    let value = raw.trim();
    const shorthand = SHORTHAND.exec(value);
    if (shorthand !== null)
        return `https://${HOSTS[shorthand[1]]}/${shorthand[2]}`;
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value))
        return `https://github.com/${value}`;
    value = value
        .replace(/^git\+/, '')
        .replace(/^git@([^:]+):/, 'https://$1/')
        .replace(/^ssh:\/\/git@/, 'https://')
        .replace(/^git:\/\//, 'https://')
        .replace(/\.git$/, '');
    return toSafeHttpUrl(value);
}
//# sourceMappingURL=urls.js.map