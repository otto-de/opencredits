// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Quality flags attached to packages. They are written to the private audit
 * report and never rendered on the public page.
 */
export type Flag =
  | 'LICENSE_UNKNOWN'
  | 'LICENSE_NON_SPDX'
  | 'LICENSE_TEXT_MISSING'
  | 'COPYRIGHT_MISSING'
  | 'COPYRIGHT_INFERRED_FROM_AUTHOR'
  | 'HOMEPAGE_MISSING'
  | 'ENRICHMENT_FAILED'
  | 'INTEGRITY_UNVERIFIED'
  | 'CURATED'
  | 'MANUALLY_ADDED';

/** A dependency exactly as an extractor found it in one repository. */
export interface DependencyRecord {
  name: string;
  version: string;
  /** Package URL type, for example "npm" or "maven". */
  ecosystem: string;
  purl: string;
  declaredLicense?: string;
  homepage?: string;
  integrity?: string;
  repository: string;
  manifestPath: string;
  extractor: string;
}

export interface LicenseInfo {
  /** Valid SPDX license expression, or null when it could not be determined. */
  expression: string | null;
  /** License as declared by the package, used for display when no SPDX expression exists. */
  raw: string | null;
}

/** One package version after enrichment and curation. */
export interface PackageDetails {
  name: string;
  version: string;
  ecosystem: string;
  purl: string;
  license: LicenseInfo;
  licenseText: string | null;
  noticeText: string | null;
  copyrights: string[];
  homepage: string | null;
  repositories: string[];
  flags: Flag[];
}

/** A deduplicated library as stored in the internal dataset. */
export interface AggregatedPackage {
  id: string;
  name: string;
  ecosystem: string;
  license: LicenseInfo;
  licenseText: string | null;
  noticeText: string | null;
  copyrights: string[];
  homepage: string | null;
  /** Internal only: never rendered unless output.showVersions is enabled. */
  versions: string[];
  purls: string[];
  /** Internal only: never rendered. */
  repositories: string[];
  flags: Flag[];
}

export const DATASET_SCHEMA_VERSION = '1.0';

export interface Dataset {
  schemaVersion: typeof DATASET_SCHEMA_VERSION;
  generatedAt: string;
  tool: { name: string; version: string };
  packages: AggregatedPackage[];
}
