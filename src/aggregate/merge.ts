// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { DATASET_SCHEMA_VERSION, type AggregatedPackage, type Dataset, type Flag } from '../model.js';
import { assignStableIds, compareVersions, licenseLabel } from './aggregate.js';

/**
 * Merges datasets produced by separate scans — one per repository or per team —
 * into a single dataset. Grouping matches `aggregatePackages`: one entry per
 * ecosystem, name and license, so a library that changed its license between
 * versions stays visible as two entries.
 */
export function mergeAggregated(packages: readonly AggregatedPackage[]): AggregatedPackage[] {
  const groups = new Map<string, AggregatedPackage[]>();
  for (const pkg of packages) {
    const key = `${pkg.ecosystem}\u0000${pkg.name.toLowerCase()}\u0000${licenseLabel(pkg)}`;
    groups.set(key, [...(groups.get(key) ?? []), pkg]);
  }

  const merged: AggregatedPackage[] = [];
  for (const group of groups.values()) {
    // Prefer the entry holding the newest version: its texts and links are the
    // ones that match what is shipped today.
    const ordered = [...group].sort((a, b) => compareVersions(newestVersion(b), newestVersion(a)));
    const primary = ordered[0] as AggregatedPackage;
    const withText = ordered.find((pkg) => pkg.licenseText !== null);
    const withNotice = ordered.find((pkg) => pkg.noticeText !== null);
    const withHomepage = ordered.find((pkg) => pkg.homepage !== null);

    const copyrights = [...new Set(ordered.flatMap((pkg) => pkg.copyrights))];
    const flags = new Set<Flag>(ordered.flatMap((pkg) => pkg.flags));
    if (withText !== undefined) flags.delete('LICENSE_TEXT_MISSING');
    if (withHomepage !== undefined) flags.delete('HOMEPAGE_MISSING');
    if (copyrights.length > 0) flags.delete('COPYRIGHT_MISSING');

    merged.push({
      id: '',
      name: primary.name,
      ecosystem: primary.ecosystem,
      license: primary.license,
      licenseText: withText?.licenseText ?? null,
      noticeText: withNotice?.noticeText ?? null,
      copyrights,
      homepage: withHomepage?.homepage ?? null,
      versions: [...new Set(ordered.flatMap((pkg) => pkg.versions))].sort(compareVersions),
      purls: [...new Set(ordered.flatMap((pkg) => pkg.purls))].sort(),
      repositories: [...new Set(ordered.flatMap((pkg) => pkg.repositories))].sort(),
      flags: [...flags].sort(),
    });
  }

  merged.sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
      a.ecosystem.localeCompare(b.ecosystem) ||
      licenseLabel(a).localeCompare(licenseLabel(b)),
  );
  assignStableIds(merged);
  return merged;
}

function newestVersion(pkg: AggregatedPackage): string {
  return pkg.versions[pkg.versions.length - 1] ?? '0.0.0';
}

export interface NamedDataset {
  /** Where this dataset came from, for the audit report. */
  origin: string;
  dataset: Dataset;
}

export interface MergeResult {
  dataset: Dataset;
  sources: { origin: string; generatedAt: string; packages: number; repositories: string[] }[];
}

export function mergeDatasets(inputs: readonly NamedDataset[], toolVersion: string, generatedAt: Date): MergeResult {
  const packages = mergeAggregated(inputs.flatMap((input) => input.dataset.packages));
  return {
    dataset: {
      schemaVersion: DATASET_SCHEMA_VERSION,
      generatedAt: generatedAt.toISOString(),
      tool: { name: 'opencredits', version: toolVersion },
      packages,
    },
    sources: inputs.map((input) => ({
      origin: input.origin,
      generatedAt: input.dataset.generatedAt,
      packages: input.dataset.packages.length,
      repositories: [...new Set(input.dataset.packages.flatMap((pkg) => pkg.repositories))].sort(),
    })),
  };
}
