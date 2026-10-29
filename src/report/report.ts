// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto';
import type { AggregatedPackage, Dataset, Flag } from '../model.js';
import type { Category, PolicyResult } from '../policy/policy.js';

export type RepositoryStatus = 'scanned' | 'excluded' | 'failed';

export interface RepositoryResult {
  repository: string;
  status: RepositoryStatus;
  reasons: string[];
  commitSha: string | null;
  packageCount: number;
  extractors: string[];
  error: string | null;
}

/** One dataset that was merged into the result. */
export interface MergeSource {
  origin: string;
  generatedAt: string;
  packages: number;
  repositories: string[];
}

/** Private report: contains repository names and must never be published. */
export interface AuditReport {
  schemaVersion: '1.1';
  startedAt: string;
  finishedAt: string;
  summary: {
    repositoriesDiscovered: number;
    repositoriesScanned: number;
    repositoriesExcluded: number;
    repositoriesFailed: number;
    packages: number;
    packagesNeedingReview: number;
  };
  repositories: RepositoryResult[];
  /** Datasets merged into this result; empty for a plain scan. */
  sources: MergeSource[];
  review: { id: string; name: string; versions: string[]; flags: Flag[]; repositories: string[] }[];
  policy: PolicyResult | null;
  warnings: string[];
}

/** Flags that mean the public notice may be incomplete. */
export const REVIEW_FLAGS: ReadonlySet<Flag> = new Set<Flag>([
  'LICENSE_UNKNOWN',
  'LICENSE_NON_SPDX',
  'LICENSE_TEXT_MISSING',
  'COPYRIGHT_MISSING',
  'ENRICHMENT_FAILED',
  'INTEGRITY_UNVERIFIED',
]);

export function buildAuditReport(
  startedAt: Date,
  finishedAt: Date,
  repositories: RepositoryResult[],
  packages: AggregatedPackage[],
  warnings: string[],
  policy: PolicyResult | null = null,
  sources: MergeSource[] = [],
): AuditReport {
  const review = packages
    .filter((pkg) => pkg.flags.some((flag) => REVIEW_FLAGS.has(flag)))
    .map((pkg) => ({ id: pkg.id, name: pkg.name, versions: pkg.versions, flags: pkg.flags, repositories: pkg.repositories }));
  const count = (status: RepositoryStatus): number => repositories.filter((repo) => repo.status === status).length;
  return {
    schemaVersion: '1.1',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    summary: {
      repositoriesDiscovered: repositories.length,
      repositoriesScanned: count('scanned'),
      repositoriesExcluded: count('excluded'),
      repositoriesFailed: count('failed'),
      packages: packages.length,
      packagesNeedingReview: review.length,
    },
    repositories,
    sources,
    review,
    policy,
    warnings,
  };
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

export function auditToMarkdown(report: AuditReport): string {
  const s = report.summary;
  // A merge has no repositories of its own, so those counters are left out there.
  const repositoryRows =
    report.repositories.length > 0
      ? [
          `| Repositories discovered | ${s.repositoriesDiscovered} |`,
          `| Repositories scanned | ${s.repositoriesScanned} |`,
          `| Repositories excluded | ${s.repositoriesExcluded} |`,
          `| Repositories failed | ${s.repositoriesFailed} |`,
        ]
      : [];
  const lines = [
    '## OpenCredits scan summary',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    ...repositoryRows,
    `| Unique packages | ${s.packages} |`,
    `| Packages needing review | ${s.packagesNeedingReview} |`,
    '',
  ];
  if (report.sources.length > 0) {
    lines.push('### Merged datasets', '', '| Source | Generated | Packages |', '| --- | --- | ---: |');
    for (const source of report.sources) lines.push(`| ${cell(source.origin)} | ${cell(source.generatedAt)} | ${source.packages} |`);
    lines.push('');
  }
  if (report.policy !== null) lines.push(...policyLines(report.policy));
  const failed = report.repositories.filter((repo) => repo.status === 'failed');
  if (failed.length > 0) {
    lines.push('### Failed repositories', '', '| Repository | Error |', '| --- | --- |');
    for (const repo of failed) lines.push(`| ${cell(repo.repository)} | ${cell(repo.error ?? '')} |`);
    lines.push('');
  }
  if (report.review.length > 0) {
    lines.push('### Packages needing review', '', '| Package | Flags |', '| --- | --- |');
    for (const item of report.review.slice(0, 100)) lines.push(`| ${cell(item.name)} | ${item.flags.join(', ')} |`);
    if (report.review.length > 100) lines.push('', `…and ${report.review.length - 100} more in audit-report.json.`);
    lines.push('');
  }
  for (const warning of report.warnings) lines.push(`> ${cell(warning)}`);
  return `${lines.join('\n')}\n`;
}

const CATEGORY_LABELS: Record<Category, string> = {
  permissive: 'Permissive',
  'weak-copyleft': 'Weak copyleft',
  'strong-copyleft': 'Strong copyleft',
  'network-copyleft': 'Network copyleft',
  'non-free': 'Not open source',
  'case-by-case': 'Case by case',
  unknown: 'Undetermined',
};

function policyLines(policy: PolicyResult): string[] {
  const lines = [
    '### License policy',
    '',
    `Project type: **${policy.projectType}** · ruleset: **${policy.ruleset}**`,
    '',
    ...(policy.guidelinesUrl === null
      ? ['These categories are this tool\'s defaults. Check them against your own license guidelines.', '']
      : [`Categories follow your license guidelines: ${policy.guidelinesUrl}`, '']),
    '| Category | Packages |',
    '| --- | ---: |',
  ];
  for (const [category, count] of Object.entries(policy.counts)) {
    if (count > 0) lines.push(`| ${CATEGORY_LABELS[category as Category]} | ${count} |`);
  }
  lines.push('');
  if (policy.findings.length === 0) {
    lines.push('No packages need a policy decision.', '');
    return lines;
  }
  lines.push('| Package | License | Category | Verdict | Accepted |', '| --- | --- | --- | --- | --- |');
  for (const finding of policy.findings.slice(0, 100)) {
    const accepted = finding.acceptedReason === null ? 'no' : cell(finding.acceptedReason);
    lines.push(`| ${cell(finding.name)} | ${cell(finding.license)} | ${CATEGORY_LABELS[finding.category]} | ${finding.verdict} | ${accepted} |`);
  }
  if (policy.findings.length > 100) lines.push('', `…and ${policy.findings.length - 100} more in audit-report.json.`);
  lines.push('');
  if (policy.blocking.length > 0) {
    lines.push(`> **${policy.blocking.length} package(s) violate the configured policy and were not accepted by an exception.**`, '');
  }
  return lines;
}

export interface GuardResult {
  ok: boolean;
  message: string;
}

/** Blocks publishing when the package count drops suspiciously, e.g. after an authentication failure. */
export function checkPublishGuard(previous: Dataset | null, next: Dataset, maxDropPercent: number): GuardResult {
  if (previous === null || previous.packages.length === 0) return { ok: true, message: 'No previous dataset to compare with' };
  const before = previous.packages.length;
  const after = next.packages.length;
  const dropPercent = before > after ? ((before - after) / before) * 100 : 0;
  if (dropPercent > maxDropPercent) {
    return {
      ok: false,
      message: `Package count dropped from ${before} to ${after} (${dropPercent.toFixed(1)}%), above the ${maxDropPercent}% limit`,
    };
  }
  return { ok: true, message: `Package count changed from ${before} to ${after}` };
}

/** Exports the dataset as an SPDX 2.3 JSON document for exchange with other compliance tools. */
export function datasetToSpdx(dataset: Dataset, documentName: string): Record<string, unknown> {
  const packages = dataset.packages.map((pkg, index) => {
    const spdxPackage: Record<string, unknown> = {
      SPDXID: `SPDXRef-Package-${index + 1}`,
      name: pkg.name,
      versionInfo: pkg.versions[pkg.versions.length - 1] ?? 'NOASSERTION',
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: pkg.license.expression ?? 'NOASSERTION',
      copyrightText: pkg.copyrights.length > 0 ? pkg.copyrights.join('\n') : 'NOASSERTION',
      externalRefs: pkg.purls.map((purl) => ({ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: purl })),
    };
    if (pkg.homepage !== null) spdxPackage.homepage = pkg.homepage;
    return spdxPackage;
  });
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: documentName,
    documentNamespace: `https://spdx.org/spdxdocs/opencredits-${randomUUID()}`,
    creationInfo: { created: dataset.generatedAt, creators: [`Tool: ${dataset.tool.name}-${dataset.tool.version}`] },
    packages,
    relationships: packages.map((pkg) => ({
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: pkg.SPDXID,
    })),
  };
}
