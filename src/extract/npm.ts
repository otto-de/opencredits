// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '../util/log.js';
import { npmPurl } from '../util/purl.js';
import { type ExtractContext, type ExtractedDependency, type Extractor, findFiles } from './types.js';

const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
const MAX_LOCKFILE_BYTES = 100 * 1024 * 1024;

export interface NpmPackage {
  name: string;
  version: string;
  integrity?: string;
  license?: string;
}

type LockEntry = Record<string, unknown>;

function licenseField(entry: LockEntry): string | undefined {
  return typeof entry.license === 'string' ? entry.license : undefined;
}

/** Resolves "npm:real-name@1.2.3" aliases used in lockfile v1. */
function resolveAlias(name: string, version: string): { name: string; version: string } {
  if (version.startsWith('npm:')) {
    const spec = version.slice(4);
    const at = spec.lastIndexOf('@');
    if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  }
  return { name, version };
}

function isRegistryVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

/**
 * Parses package-lock.json / npm-shrinkwrap.json (lockfileVersion 1, 2 and 3).
 * Dev dependencies are skipped unless includeDev is set. "devOptional" packages
 * are kept: over-reporting a notice is safer than omitting one.
 */
export function parseNpmLockfile(lock: unknown, includeDev: boolean): NpmPackage[] {
  if (typeof lock !== 'object' || lock === null) return [];
  const root = lock as LockEntry;
  const found = new Map<string, NpmPackage>();

  const add = (rawName: string, entry: LockEntry): void => {
    if (typeof entry.version !== 'string') return;
    if (entry.dev === true && !includeDev) return;
    if (entry.extraneous === true || entry.link === true) return;
    const { name, version } = resolveAlias(typeof entry.name === 'string' ? entry.name : rawName, entry.version);
    if (!NPM_NAME.test(name)) {
      log.warn('Skipping npm package with invalid name', { name });
      return;
    }
    if (!isRegistryVersion(version)) {
      log.debug('Skipping non-registry npm dependency', { name, version });
      return;
    }
    const pkg: NpmPackage = { name, version };
    if (typeof entry.integrity === 'string') pkg.integrity = entry.integrity;
    const license = licenseField(entry);
    if (license !== undefined) pkg.license = license;
    found.set(`${name}@${version}`, pkg);
  };

  if (typeof root.packages === 'object' && root.packages !== null) {
    for (const [key, value] of Object.entries(root.packages as Record<string, LockEntry>)) {
      const marker = key.lastIndexOf('node_modules/');
      // "" is the root project; keys without node_modules are workspace sources.
      if (marker < 0) continue;
      add(key.slice(marker + 'node_modules/'.length), value);
    }
  } else if (typeof root.dependencies === 'object' && root.dependencies !== null) {
    const walk = (deps: Record<string, LockEntry>): void => {
      for (const [name, entry] of Object.entries(deps)) {
        add(name, entry);
        if (typeof entry.dependencies === 'object' && entry.dependencies !== null) {
          walk(entry.dependencies as Record<string, LockEntry>);
        }
      }
    };
    walk(root.dependencies as Record<string, LockEntry>);
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export const npmExtractor: Extractor = {
  name: 'npm',
  ecosystems: ['npm'],

  async extract(rootDir: string, context: ExtractContext): Promise<ExtractedDependency[]> {
    const lockfiles = await findFiles(rootDir, (name) => name === 'package-lock.json' || name === 'npm-shrinkwrap.json');
    const results: ExtractedDependency[] = [];
    for (const manifestPath of lockfiles) {
      const full = join(rootDir, manifestPath);
      if ((await stat(full)).size > MAX_LOCKFILE_BYTES) {
        log.warn('Skipping oversized lockfile', { manifestPath });
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(full, 'utf8'));
      } catch {
        log.warn('Skipping unparsable lockfile', { manifestPath });
        continue;
      }
      for (const pkg of parseNpmLockfile(parsed, context.includeDevDependencies)) {
        const record: ExtractedDependency = {
          name: pkg.name,
          version: pkg.version,
          ecosystem: 'npm',
          purl: npmPurl(pkg.name, pkg.version),
          manifestPath,
          extractor: 'npm',
        };
        if (pkg.license !== undefined) record.declaredLicense = pkg.license;
        if (pkg.integrity !== undefined) record.integrity = pkg.integrity;
        results.push(record);
      }
    }
    return results;
  },
};
