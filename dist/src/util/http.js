// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import { setTimeout as sleep } from 'node:timers/promises';
import { SafetyLimitError } from './errors.js';
import { log } from './log.js';
export class HttpError extends Error {
    status;
    url;
    name = 'HttpError';
    constructor(status, url) {
        super(`HTTP ${status} for ${stripQuery(url)}`);
        this.status = status;
        this.url = url;
    }
}
const DEFAULTS = {
    timeoutMs: 30_000,
    retries: 3,
    maxRateLimitWaitMs: 15 * 60_000,
    backoffBaseMs: 500,
};
/** Removes query strings so signed URLs and tokens never reach the logs. */
export function stripQuery(url) {
    const index = url.indexOf('?');
    return index >= 0 ? url.slice(0, index) : url;
}
function rateLimitWaitMs(response, now) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter !== null && /^\d+$/.test(retryAfter))
        return Number(retryAfter) * 1000;
    if (response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        if (Number.isFinite(reset) && reset > 0)
            return Math.max(0, reset * 1000 - now) + 1000;
    }
    return null;
}
function isRetryableStatus(status) {
    return status === 429 || status === 502 || status === 503 || status === 504 || status === 500;
}
export function createHttpClient(defaults = {}) {
    const base = { ...DEFAULTS, ...defaults };
    return {
        async request(url, options = {}) {
            const retries = options.retries ?? base.retries;
            const backoff = options.backoffBaseMs ?? base.backoffBaseMs;
            const maxWait = options.maxRateLimitWaitMs ?? base.maxRateLimitWaitMs;
            for (let attempt = 0;; attempt++) {
                let response;
                try {
                    const init = {
                        method: options.method ?? 'GET',
                        headers: options.headers ?? {},
                        redirect: 'follow',
                        signal: AbortSignal.timeout(options.timeoutMs ?? base.timeoutMs),
                    };
                    if (options.body !== undefined)
                        init.body = options.body;
                    response = await fetch(url, init);
                }
                catch (error) {
                    if (attempt >= retries)
                        throw error;
                    await sleep(backoff * 2 ** attempt);
                    continue;
                }
                const rateLimited = response.status === 429 || (response.status === 403 && rateLimitWaitMs(response, Date.now()) !== null);
                if ((rateLimited || isRetryableStatus(response.status)) && attempt < retries) {
                    const wait = rateLimited ? rateLimitWaitMs(response, Date.now()) : null;
                    await response.body?.cancel();
                    if (wait !== null && wait > maxWait) {
                        throw new HttpError(response.status, url);
                    }
                    const delay = wait ?? backoff * 2 ** attempt + Math.floor(Math.random() * backoff);
                    log.warn('Retrying HTTP request', { url: stripQuery(url), status: response.status, delayMs: delay });
                    await sleep(delay);
                    continue;
                }
                return response;
            }
        },
    };
}
/** Reads a response body, aborting once it exceeds maxBytes. */
export async function readBodyLimited(response, maxBytes) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel();
        throw new SafetyLimitError(`Response larger than ${maxBytes} bytes: ${stripQuery(response.url)}`);
    }
    if (response.body === null)
        return Buffer.alloc(0);
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > maxBytes) {
            // Throwing inside for-await releases and cancels the underlying stream.
            throw new SafetyLimitError(`Response larger than ${maxBytes} bytes: ${stripQuery(response.url)}`);
        }
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}
export async function readJsonLimited(response, maxBytes) {
    const body = await readBodyLimited(response, maxBytes);
    return JSON.parse(body.toString('utf8'));
}
export async function expectOk(response) {
    if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(response.status, response.url);
    }
    return response;
}
//# sourceMappingURL=http.js.map