// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { createHash, timingSafeEqual } from 'node:crypto';
import type { EnrichmentConfig } from '../config/config.js';
import type { Flag } from '../model.js';
import { readFilesFromTarGz } from '../fetch/tar.js';
import { errorMessage } from '../util/errors.js';
import { expectOk, type HttpClient, readBodyLimited, readJsonLimited } from '../util/http.js';
import { log } from '../util/log.js';
import {
  extractCopyrights,
  isLicenseFileName,
  isNoticeFileName,
  normalizeDeclaredLicense,
  normalizeText,
  type NormalizedLicense,
  rankLicenseFile,
  stripEmails,
} from './license.js';
import { repositoryUrl, toSafeHttpUrl } from './urls.js';

export interface NpmEnrichment {
  license: NormalizedLicense;
  licenseText: string | null;
  noticeText: string | null;
  copyrights: string[];
  homepage: string | null;
  flags: Flag[];
}

const ALGORITHM_STRENGTH = ['sha512', 'sha384', 'sha256', 'sha1'] as const;
type Algorithm = (typeof ALGORITHM_STRENGTH)[number];

/** Parses Subresource Integrity strings such as "sha512-abc== sha1-def=". */
export function parseIntegrity(value: string): { algorithm: Algorithm; digest: Buffer } | null {
  const candidates = value
    .trim()
    .split(/\s+/)
    .map((part) => {
      const dash = part.indexOf('-');
      return { algorithm: part.slice(0, dash) as Algorithm, digest: part.slice(dash + 1).split('?')[0] ?? '' };
    })
    .filter((c) => (ALGORITHM_STRENGTH as readonly string[]).includes(c.algorithm) && c.digest !== '');
  candidates.sort((a, b) => ALGORITHM_STRENGTH.indexOf(a.algorithm) - ALGORITHM_STRENGTH.indexOf(b.algorithm));
  const best = candidates[0];
  if (best === undefined) return null;
  const digest = Buffer.from(best.digest, 'base64');
  return digest.length > 0 ? { algorithm: best.algorithm, digest } : null;
}

export function verifyIntegrity(data: Buffer, integrity: string): boolean {
  const parsed = parseIntegrity(integrity);
  if (parsed === null) return false;
  const actual = createHash(parsed.algorithm).update(data).digest();
  return actual.length === parsed.digest.length && timingSafeEqual(actual, parsed.digest);
}

function encodePackageName(name: string): string {
  return name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

function authorName(author: unknown): string | null {
  if (typeof author === 'string') return author;
  if (typeof author === 'object' && author !== null && typeof (author as { name?: unknown }).name === 'string') {
    return (author as { name: string }).name;
  }
  return null;
}

export async function enrichFromNpmRegistry(
  pkg: { name: string; version: string; integrity?: string },
  config: EnrichmentConfig['npmRegistry'],
  http: HttpClient,
  options: { stripEmails: boolean },
): Promise<NpmEnrichment> {
  const flags = new Set<Flag>();
  const manifestUrl = `${config.url}/${encodePackageName(pkg.name)}/${encodeURIComponent(pkg.version)}`;
  const manifest = (await readJsonLimited(
    await expectOk(await http.request(manifestUrl, { headers: { Accept: 'application/json' } })),
    10 * 1024 * 1024,
  )) as Record<string, unknown>;

  const license = normalizeDeclaredLicense(manifest.license ?? manifest.licenses);
  const homepage = repositoryUrl(manifest.repository) ?? toSafeHttpUrl(manifest.homepage);

  let licenseText: string | null = null;
  let noticeText: string | null = null;

  const dist = (manifest.dist ?? {}) as { tarball?: unknown; integrity?: unknown; shasum?: unknown };
  const tarballUrl = toSafeHttpUrl(dist.tarball);
  const expectedIntegrity =
    pkg.integrity ??
    (typeof dist.integrity === 'string' ? dist.integrity : typeof dist.shasum === 'string' ? `sha1-${Buffer.from(dist.shasum, 'hex').toString('base64')}` : undefined);

  if (tarballUrl === null) {
    flags.add('LICENSE_TEXT_MISSING');
  } else if (!config.allowedTarballHosts.includes(new URL(tarballUrl).host)) {
    log.warn('Tarball host is not allowed; skipping license file download', { package: pkg.name, host: new URL(tarballUrl).host });
    flags.add('LICENSE_TEXT_MISSING');
  } else {
    try {
      const response = await expectOk(await http.request(tarballUrl, { timeoutMs: 120_000 }));
      const data = await readBodyLimited(response, config.maxTarballBytes);
      if (expectedIntegrity === undefined || !verifyIntegrity(data, expectedIntegrity)) {
        // Never trust content that does not match the lockfile or registry checksum.
        flags.add('INTEGRITY_UNVERIFIED');
        flags.add('LICENSE_TEXT_MISSING');
      } else {
        const files = await readFilesFromTarGz(
          data,
          (path) => !path.includes('/') && (isLicenseFileName(path) || isNoticeFileName(path)),
          { maxEntryBytes: 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, maxEntries: 100_000, maxStreamBytes: 512 * 1024 * 1024 },
          1,
        );
        const names = [...files.keys()];
        const licenseFile = names.filter(isLicenseFileName).sort((a, b) => rankLicenseFile(a) - rankLicenseFile(b))[0];
        const noticeFile = names.filter(isNoticeFileName).sort()[0];
        if (licenseFile !== undefined) licenseText = normalizeText((files.get(licenseFile) as Buffer).toString('utf8'));
        if (noticeFile !== undefined) noticeText = normalizeText((files.get(noticeFile) as Buffer).toString('utf8'));
        if (licenseText === null) flags.add('LICENSE_TEXT_MISSING');
      }
    } catch (error) {
      log.warn('Could not read package tarball', { package: pkg.name, version: pkg.version, error: errorMessage(error) });
      flags.add('ENRICHMENT_FAILED');
      flags.add('LICENSE_TEXT_MISSING');
    }
  }

  let copyrights = [licenseText, noticeText]
    .filter((text): text is string => text !== null)
    .flatMap((text) => extractCopyrights(text, options));
  copyrights = [...new Set(copyrights)];
  if (copyrights.length === 0) {
    const author = authorName(manifest.author);
    const cleaned = author === null ? '' : options.stripEmails ? stripEmails(author) : author;
    if (cleaned !== '') {
      copyrights = [cleaned];
      flags.add('COPYRIGHT_INFERRED_FROM_AUTHOR');
    } else {
      flags.add('COPYRIGHT_MISSING');
    }
  }

  for (const flag of license.flags) flags.add(flag);
  if (homepage === null) flags.add('HOMEPAGE_MISSING');
  return { license, licenseText, noticeText, copyrights, homepage, flags: [...flags] };
}
