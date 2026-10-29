// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import type { Flag, PackageDetails } from '../model.js';
import { ConfigError } from '../util/errors.js';
import { normalizeLicenseExpression, normalizeText } from './license.js';
import { toSafeHttpUrl } from './urls.js';

/**
 * Curations let people correct or complete data that scanners cannot know,
 * for example a missing copyright holder. Additions declare components that no
 * package manager knows about, such as source code copied into a repository.
 * Every entry requires a reason so the audit trail explains the change.
 */
export interface Curation {
  match: { name: string; ecosystem?: string; version?: string };
  set: { license?: string; copyrights?: string[]; homepage?: string; licenseText?: string };
  exclude: boolean;
  reason: string;
}

export interface Addition {
  name: string;
  ecosystem: string;
  version: string;
  license: string;
  copyrights: string[];
  homepage: string | null;
  licenseText: string | null;
  reason: string;
}

export interface Curations {
  curations: Curation[];
  additions: Addition[];
}

async function readTextFileInside(baseDir: string, file: unknown, field: string, problems: string[]): Promise<string | undefined> {
  if (file === undefined) return undefined;
  if (typeof file !== 'string' || isAbsolute(file)) {
    problems.push(`${field} must be a relative path`);
    return undefined;
  }
  try {
    const base = await realpath(baseDir);
    const target = await realpath(resolve(baseDir, file));
    const rel = relative(base, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      problems.push(`${field} must stay inside the curations directory`);
      return undefined;
    }
    return normalizeText(await readFile(target, 'utf8'));
  } catch {
    problems.push(`${field} could not be read: ${file}`);
    return undefined;
  }
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : undefined;
}

export async function loadCurations(path: string): Promise<Curations> {
  const baseDir = dirname(path);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new ConfigError([`Could not read curations file ${path}: ${error instanceof Error ? error.message : String(error)}`]);
  }
  const problems: string[] = [];
  const root = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const curations: Curation[] = [];
  const additions: Addition[] = [];

  const rawCurations = Array.isArray(root.curations) ? (root.curations as Record<string, unknown>[]) : [];
  for (const [index, entry] of rawCurations.entries()) {
    const at = `curations[${index}]`;
    const match = (entry.match ?? {}) as Record<string, unknown>;
    const set = (entry.set ?? {}) as Record<string, unknown>;
    if (typeof match.name !== 'string' || match.name === '') problems.push(`${at}.match.name is required`);
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') problems.push(`${at}.reason is required`);
    const curation: Curation = {
      match: { name: String(match.name ?? '') },
      set: {},
      exclude: entry.exclude === true,
      reason: String(entry.reason ?? ''),
    };
    if (typeof match.ecosystem === 'string') curation.match.ecosystem = match.ecosystem;
    if (typeof match.version === 'string') curation.match.version = match.version;
    if (typeof set.license === 'string') curation.set.license = set.license;
    const copyrights = stringList(set.copyrights);
    if (copyrights !== undefined) curation.set.copyrights = copyrights;
    if (set.homepage !== undefined) {
      const homepage = toSafeHttpUrl(set.homepage);
      if (homepage === null) problems.push(`${at}.set.homepage must be an http(s) URL`);
      else curation.set.homepage = homepage;
    }
    const text = await readTextFileInside(baseDir, set.licenseTextFile, `${at}.set.licenseTextFile`, problems);
    if (text !== undefined) curation.set.licenseText = text;
    curations.push(curation);
  }

  const rawAdditions = Array.isArray(root.additions) ? (root.additions as Record<string, unknown>[]) : [];
  for (const [index, entry] of rawAdditions.entries()) {
    const at = `additions[${index}]`;
    if (typeof entry.name !== 'string' || entry.name === '') problems.push(`${at}.name is required`);
    if (typeof entry.license !== 'string' || entry.license === '') problems.push(`${at}.license is required`);
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') problems.push(`${at}.reason is required`);
    const homepage = entry.homepage === undefined ? null : toSafeHttpUrl(entry.homepage);
    if (entry.homepage !== undefined && homepage === null) problems.push(`${at}.homepage must be an http(s) URL`);
    additions.push({
      name: String(entry.name ?? ''),
      ecosystem: typeof entry.ecosystem === 'string' ? entry.ecosystem : 'generic',
      version: typeof entry.version === 'string' ? entry.version : 'unversioned',
      license: String(entry.license ?? ''),
      copyrights: stringList(entry.copyrights) ?? [],
      homepage,
      licenseText: (await readTextFileInside(baseDir, entry.licenseTextFile, `${at}.licenseTextFile`, problems)) ?? null,
      reason: String(entry.reason ?? ''),
    });
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return { curations, additions };
}

function matches(curation: Curation, pkg: PackageDetails): boolean {
  const { name, ecosystem, version } = curation.match;
  return (
    name.toLowerCase() === pkg.name.toLowerCase() &&
    (ecosystem === undefined || ecosystem === pkg.ecosystem) &&
    (version === undefined || version === '*' || version === pkg.version)
  );
}

const RESOLVED_BY_CURATION: Partial<Record<keyof Curation['set'], Flag[]>> = {
  license: ['LICENSE_UNKNOWN', 'LICENSE_NON_SPDX'],
  licenseText: ['LICENSE_TEXT_MISSING'],
  copyrights: ['COPYRIGHT_MISSING', 'COPYRIGHT_INFERRED_FROM_AUTHOR'],
  homepage: ['HOMEPAGE_MISSING'],
};

export function applyCurations(packages: PackageDetails[], curations: Curations): PackageDetails[] {
  const result: PackageDetails[] = [];
  for (const original of packages) {
    let pkg = original;
    let excluded = false;
    for (const curation of curations.curations) {
      if (!matches(curation, pkg)) continue;
      if (curation.exclude) {
        excluded = true;
        break;
      }
      const resolved = new Set<Flag>();
      const next: PackageDetails = { ...pkg, flags: [...pkg.flags] };
      if (curation.set.license !== undefined) {
        const license = normalizeLicenseExpression(curation.set.license);
        next.license = { expression: license.expression, raw: license.raw };
        RESOLVED_BY_CURATION.license?.forEach((flag) => resolved.add(flag));
        license.flags.forEach((flag) => next.flags.push(flag));
      }
      if (curation.set.licenseText !== undefined) {
        next.licenseText = curation.set.licenseText;
        RESOLVED_BY_CURATION.licenseText?.forEach((flag) => resolved.add(flag));
      }
      if (curation.set.copyrights !== undefined) {
        next.copyrights = curation.set.copyrights;
        RESOLVED_BY_CURATION.copyrights?.forEach((flag) => resolved.add(flag));
      }
      if (curation.set.homepage !== undefined) {
        next.homepage = curation.set.homepage;
        RESOLVED_BY_CURATION.homepage?.forEach((flag) => resolved.add(flag));
      }
      const kept = next.flags.filter((flag) => !resolved.has(flag));
      next.flags = [...new Set<Flag>([...kept, 'CURATED'])];
      pkg = next;
    }
    if (!excluded) result.push(pkg);
  }

  for (const addition of curations.additions) {
    const license = normalizeLicenseExpression(addition.license);
    const flags = new Set<Flag>(['MANUALLY_ADDED', ...license.flags]);
    if (addition.licenseText === null) flags.add('LICENSE_TEXT_MISSING');
    if (addition.copyrights.length === 0) flags.add('COPYRIGHT_MISSING');
    result.push({
      name: addition.name,
      version: addition.version,
      ecosystem: addition.ecosystem,
      purl: `pkg:${addition.ecosystem}/${encodeURIComponent(addition.name)}@${encodeURIComponent(addition.version)}`,
      license: { expression: license.expression, raw: license.raw },
      licenseText: addition.licenseText,
      noticeText: null,
      copyrights: addition.copyrights,
      homepage: addition.homepage,
      repositories: [],
      flags: [...flags],
    });
  }
  return result;
}
