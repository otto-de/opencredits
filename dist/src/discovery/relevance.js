// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import { globToRegExp, matchesAny } from '../util/glob.js';
const MAX_DEPLOYMENT_FILE_BYTES = 256 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Matches a domain or any subdomain of it, e.g. "example.com" matches "www.example.com". */
export function domainPattern(domains) {
    if (domains.length === 0)
        return null;
    const alternatives = domains.map((domain) => escapeRegExp(domain.toLowerCase())).join('|');
    return new RegExp(`(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\\.)*(?:${alternatives})(?!\\.?[a-z0-9-])`, 'i');
}
function listed(list, fullName) {
    const lower = fullName.toLowerCase();
    return list.some((entry) => entry.toLowerCase() === lower);
}
export async function evaluateRelevance(repo, api, config, now = new Date()) {
    if (listed(config.denylist, repo.fullName)) {
        return { relevant: false, reasons: ['Repository is on the denylist'], headSha: null };
    }
    if (listed(config.allowlist, repo.fullName)) {
        return { relevant: true, reasons: ['Repository is on the allowlist'], headSha: await api.getBranchHeadSha(repo) };
    }
    if (config.excludeArchived && repo.archived) {
        return { relevant: false, reasons: ['Repository is archived'], headSha: null };
    }
    if (config.excludeForks && repo.fork) {
        return { relevant: false, reasons: ['Repository is a fork'], headSha: null };
    }
    const reasons = [];
    const lastRun = await api.getLatestSuccessfulRunDate(repo);
    const windowStart = now.getTime() - config.ciWindowDays * DAY_MS;
    if (lastRun !== null && lastRun.getTime() >= windowStart) {
        return {
            relevant: true,
            reasons: [`Successful CI run on ${repo.defaultBranch} at ${lastRun.toISOString()}`],
            headSha: await api.getBranchHeadSha(repo),
        };
    }
    reasons.push(lastRun === null
        ? 'No successful CI run found on the default branch'
        : `Last successful CI run ${lastRun.toISOString()} is older than ${config.ciWindowDays} days`);
    const domains = domainPattern(config.deploymentDomains);
    if (domains === null || config.maxDeploymentFilesToInspect === 0) {
        reasons.push('Deployment configuration check is disabled');
        return { relevant: false, reasons, headSha: null };
    }
    const headSha = await api.getBranchHeadSha(repo);
    const { entries, truncated } = await api.listTree(repo, headSha);
    const patterns = config.deploymentFilePatterns.map(globToRegExp);
    const candidates = entries
        .filter((entry) => entry.size <= MAX_DEPLOYMENT_FILE_BYTES && matchesAny(entry.path, patterns))
        .slice(0, config.maxDeploymentFilesToInspect);
    for (const candidate of candidates) {
        const text = await api.getBlobText(repo, candidate.sha, MAX_DEPLOYMENT_FILE_BYTES);
        if (domains.test(text)) {
            return {
                relevant: true,
                reasons: [...reasons, `Deployment configuration ${candidate.path} references a configured domain`],
                headSha,
            };
        }
    }
    reasons.push(candidates.length === 0
        ? 'No deployment configuration files found'
        : `None of ${candidates.length} deployment configuration files reference a configured domain`);
    if (truncated)
        reasons.push('Repository tree was truncated by GitHub; consider adding it to the allowlist');
    return { relevant: false, reasons, headSha: null };
}
//# sourceMappingURL=relevance.js.map