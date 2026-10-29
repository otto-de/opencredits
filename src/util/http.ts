// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { setTimeout as sleep } from 'node:timers/promises';
import { SafetyLimitError } from './errors.js';
import { log } from './log.js';

export class HttpError extends Error {
  override readonly name = 'HttpError';
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${stripQuery(url)}`);
  }
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  /** Longest time to wait for a rate limit reset before giving up. */
  maxRateLimitWaitMs?: number;
  backoffBaseMs?: number;
}

export interface HttpClient {
  request(url: string, options?: HttpOptions): Promise<Response>;
}

const DEFAULTS = {
  timeoutMs: 30_000,
  retries: 3,
  maxRateLimitWaitMs: 15 * 60_000,
  backoffBaseMs: 500,
};

/** Removes query strings so signed URLs and tokens never reach the logs. */
export function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index >= 0 ? url.slice(0, index) : url;
}

function rateLimitWaitMs(response: Response, now: number): number | null {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  if (response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - now) + 1000;
  }
  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 500;
}

export function createHttpClient(defaults: Partial<typeof DEFAULTS> = {}): HttpClient {
  const base = { ...DEFAULTS, ...defaults };
  return {
    async request(url: string, options: HttpOptions = {}): Promise<Response> {
      const retries = options.retries ?? base.retries;
      const backoff = options.backoffBaseMs ?? base.backoffBaseMs;
      const maxWait = options.maxRateLimitWaitMs ?? base.maxRateLimitWaitMs;

      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          const init: RequestInit = {
            method: options.method ?? 'GET',
            headers: options.headers ?? {},
            redirect: 'follow',
            signal: AbortSignal.timeout(options.timeoutMs ?? base.timeoutMs),
          };
          if (options.body !== undefined) init.body = options.body;
          response = await fetch(url, init);
        } catch (error) {
          if (attempt >= retries) throw error;
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
export async function readBodyLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new SafetyLimitError(`Response larger than ${maxBytes} bytes: ${stripQuery(response.url)}`);
  }
  if (response.body === null) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
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

export async function readJsonLimited(response: Response, maxBytes: number): Promise<unknown> {
  const body = await readBodyLimited(response, maxBytes);
  return JSON.parse(body.toString('utf8')) as unknown;
}

export async function expectOk(response: Response): Promise<Response> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(response.status, response.url);
  }
  return response;
}
