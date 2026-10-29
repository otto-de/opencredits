// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { contrastRatio, DARK_BACKGROUND, LIGHT_BACKGROUND, MIN_TEXT_CONTRAST } from '../util/contrast.js';
import { ConfigError } from '../util/errors.js';
export const DEFAULT_DEPLOYMENT_FILE_PATTERNS = [
    '**/*.tf',
    '**/*.tfvars',
    '**/Chart.yaml',
    '**/values*.yaml',
    '**/values*.yml',
    '**/k8s/**/*.yaml',
    '**/k8s/**/*.yml',
    '**/kubernetes/**/*.yaml',
    '**/kubernetes/**/*.yml',
    '**/deploy/**/*.yaml',
    '**/deploy/**/*.yml',
    '**/deployment/**/*.yaml',
    '**/deployment/**/*.yml',
    '**/manifests/**/*.yaml',
    '**/manifests/**/*.yml',
    '**/helm/**/*.yaml',
    '**/charts/**/*.yaml',
    '**/*ingress*.yaml',
    '**/*ingress*.yml',
];
const MB = 1024 * 1024;
class Validator {
    problems = [];
    object(value, path) {
        if (value === undefined)
            return {};
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            this.problems.push(`${path} must be an object`);
            return {};
        }
        return value;
    }
    string(obj, key, path, fallback, pattern) {
        const value = obj[key];
        if (value === undefined)
            return fallback;
        if (typeof value !== 'string' || value.length === 0) {
            this.problems.push(`${path}.${key} must be a non-empty string`);
            return fallback;
        }
        if (pattern !== undefined && !pattern.test(value)) {
            this.problems.push(`${path}.${key} has an invalid format: ${JSON.stringify(value)}`);
            return fallback;
        }
        return value;
    }
    nullableString(obj, key, path) {
        const value = obj[key];
        if (value === undefined || value === null)
            return null;
        if (typeof value !== 'string') {
            this.problems.push(`${path}.${key} must be a string or null`);
            return null;
        }
        return value;
    }
    boolean(obj, key, path, fallback) {
        const value = obj[key];
        if (value === undefined)
            return fallback;
        if (typeof value !== 'boolean') {
            this.problems.push(`${path}.${key} must be a boolean`);
            return fallback;
        }
        return value;
    }
    integer(obj, key, path, fallback, min, max) {
        const value = obj[key];
        if (value === undefined)
            return fallback;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
            this.problems.push(`${path}.${key} must be an integer between ${min} and ${max}`);
            return fallback;
        }
        return value;
    }
    stringArray(obj, key, path, fallback, pattern) {
        const value = obj[key];
        if (value === undefined)
            return fallback;
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
            this.problems.push(`${path}.${key} must be an array of strings`);
            return fallback;
        }
        const strings = value;
        if (pattern !== undefined) {
            for (const item of strings) {
                if (!pattern.test(item))
                    this.problems.push(`${path}.${key} contains an invalid value: ${JSON.stringify(item)}`);
            }
        }
        return strings;
    }
    oneOf(obj, key, path, allowed, fallback) {
        const value = obj[key];
        if (value === undefined)
            return fallback;
        if (typeof value !== 'string' || !allowed.includes(value)) {
            this.problems.push(`${path}.${key} must be one of: ${allowed.join(', ')}`);
            return fallback;
        }
        return value;
    }
}
const ORG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
function isSafeServiceUrl(value) {
    try {
        const url = new URL(value);
        if (url.username !== '' || url.password !== '')
            return false;
        if (url.protocol === 'https:')
            return true;
        // Plain HTTP is only accepted for local development and tests.
        return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    }
    catch {
        return false;
    }
}
/** Validates raw JSON configuration and applies defaults. Relative paths resolve against baseDir. */
export function parseConfig(raw, baseDir) {
    const v = new Validator();
    const root = v.object(raw, 'config');
    const allowedTop = new Set(['$schema', 'source', 'relevance', 'extraction', 'enrichment', 'output', 'policy', 'guard', 'concurrency']);
    for (const key of Object.keys(root)) {
        if (!allowedTop.has(key))
            v.problems.push(`config.${key} is not a known setting`);
    }
    const src = v.object(root.source, 'source');
    const sourceType = v.oneOf(src, 'type', 'source', ['github', 'repositories', 'local'], 'local');
    let source;
    if (sourceType === 'repositories') {
        const apiUrl = v.string(src, 'apiUrl', 'source', 'https://api.github.com');
        if (!isSafeServiceUrl(apiUrl))
            v.problems.push('source.apiUrl must be an https URL without credentials');
        const repositories = v.stringArray(src, 'repositories', 'source', [], REPO_PATTERN);
        if (repositories.length === 0)
            v.problems.push('source.repositories must list at least one "owner/name" repository');
        source = {
            type: 'repositories',
            apiUrl: apiUrl.replace(/\/+$/, ''),
            repositories: [...new Set(repositories)],
            auth: v.oneOf(src, 'auth', 'source', ['token', 'app'], 'app'),
        };
    }
    else if (sourceType === 'github') {
        const apiUrl = v.string(src, 'apiUrl', 'source', 'https://api.github.com');
        if (!isSafeServiceUrl(apiUrl))
            v.problems.push('source.apiUrl must be an https URL without credentials');
        const organizations = v.stringArray(src, 'organizations', 'source', [], ORG_PATTERN);
        if (organizations.length === 0)
            v.problems.push('source.organizations must list at least one organization');
        source = {
            type: 'github',
            apiUrl: apiUrl.replace(/\/+$/, ''),
            organizations,
            auth: v.oneOf(src, 'auth', 'source', ['token', 'app'], 'app'),
        };
    }
    else {
        const paths = v.stringArray(src, 'paths', 'source', ['.']);
        source = { type: 'local', paths: paths.map((p) => resolve(baseDir, p)) };
    }
    const rel = v.object(root.relevance, 'relevance');
    const relevance = {
        excludeArchived: v.boolean(rel, 'excludeArchived', 'relevance', true),
        excludeForks: v.boolean(rel, 'excludeForks', 'relevance', true),
        ciWindowDays: v.integer(rel, 'ciWindowDays', 'relevance', 30, 1, 3650),
        deploymentDomains: v.stringArray(rel, 'deploymentDomains', 'relevance', [], DOMAIN_PATTERN),
        deploymentFilePatterns: v.stringArray(rel, 'deploymentFilePatterns', 'relevance', DEFAULT_DEPLOYMENT_FILE_PATTERNS),
        maxDeploymentFilesToInspect: v.integer(rel, 'maxDeploymentFilesToInspect', 'relevance', 40, 0, 1000),
        allowlist: v.stringArray(rel, 'allowlist', 'relevance', [], REPO_PATTERN),
        denylist: v.stringArray(rel, 'denylist', 'relevance', [], REPO_PATTERN),
    };
    const ext = v.object(root.extraction, 'extraction');
    const extractors = v.stringArray(ext, 'extractors', 'extraction', ['npm', 'syft']);
    for (const name of extractors) {
        if (name !== 'npm' && name !== 'syft')
            v.problems.push(`extraction.extractors contains unknown extractor ${JSON.stringify(name)}`);
    }
    const extraction = {
        extractors: extractors.filter((name) => name === 'npm' || name === 'syft'),
        includeDevDependencies: v.boolean(ext, 'includeDevDependencies', 'extraction', false),
        mode: v.oneOf(ext, 'mode', 'extraction', ['manifests', 'full'], 'manifests'),
        syftPath: v.string(ext, 'syftPath', 'extraction', 'syft'),
        timeoutSeconds: v.integer(ext, 'timeoutSeconds', 'extraction', 300, 10, 3600),
        maxArchiveBytes: v.integer(ext, 'maxArchiveMB', 'extraction', 500, 1, 10_000) * MB,
        maxExtractedBytes: v.integer(ext, 'maxExtractedMB', 'extraction', 1000, 1, 20_000) * MB,
    };
    const enr = v.object(root.enrichment, 'enrichment');
    const npm = v.object(enr.npmRegistry, 'enrichment.npmRegistry');
    const registryUrl = v.string(npm, 'url', 'enrichment.npmRegistry', 'https://registry.npmjs.org').replace(/\/+$/, '');
    if (!isSafeServiceUrl(registryUrl))
        v.problems.push('enrichment.npmRegistry.url must be an https URL without credentials');
    let registryHost = 'registry.npmjs.org';
    try {
        registryHost = new URL(registryUrl).host;
    }
    catch {
        // Reported above.
    }
    const curationsFile = v.nullableString(enr, 'curationsFile', 'enrichment');
    const enrichment = {
        npmRegistry: {
            enabled: v.boolean(npm, 'enabled', 'enrichment.npmRegistry', true),
            url: registryUrl,
            allowedTarballHosts: v.stringArray(npm, 'allowedTarballHosts', 'enrichment.npmRegistry', [registryHost]),
            maxTarballBytes: v.integer(npm, 'maxTarballMB', 'enrichment.npmRegistry', 50, 1, 1000) * MB,
        },
        curationsFile: curationsFile === null ? null : resolve(baseDir, curationsFile),
    };
    const out = v.object(root.output, 'output');
    const output = {
        title: v.string(out, 'title', 'output', ''),
        intro: v.nullableString(out, 'intro', 'output'),
        language: v.oneOf(out, 'language', 'output', ['en', 'de'], 'en'),
        showVersions: v.boolean(out, 'showVersions', 'output', false),
        stripEmails: v.boolean(out, 'stripEmails', 'output', true),
        accentColor: v.string(out, 'accentColor', 'output', '#1F5F8B', HEX_COLOR),
        accentColorDark: v.string(out, 'accentColorDark', 'output', '#8CC4EA', HEX_COLOR),
    };
    // Accessibility is a hard requirement: reject colors that fail WCAG 2.1 AA for text.
    const lightContrast = contrastRatio(output.accentColor, LIGHT_BACKGROUND);
    if (lightContrast < MIN_TEXT_CONTRAST) {
        v.problems.push(`output.accentColor ${output.accentColor} has contrast ${lightContrast.toFixed(2)}:1 on ${LIGHT_BACKGROUND}; WCAG 2.1 AA needs ${MIN_TEXT_CONTRAST}:1`);
    }
    const darkContrast = contrastRatio(output.accentColorDark, DARK_BACKGROUND);
    if (darkContrast < MIN_TEXT_CONTRAST) {
        v.problems.push(`output.accentColorDark ${output.accentColorDark} has contrast ${darkContrast.toFixed(2)}:1 on ${DARK_BACKGROUND}; WCAG 2.1 AA needs ${MIN_TEXT_CONTRAST}:1`);
    }
    const pol = v.object(root.policy, 'policy');
    const overridesRaw = v.object(pol.overrides, 'policy.overrides');
    const overrides = {};
    const CATEGORIES = ['permissive', 'weak-copyleft', 'strong-copyleft', 'network-copyleft', 'non-free', 'case-by-case', 'unknown'];
    for (const [license, category] of Object.entries(overridesRaw)) {
        if (typeof category !== 'string' || !CATEGORIES.includes(category)) {
            v.problems.push(`policy.overrides.${license} must be one of: ${CATEGORIES.join(', ')}`);
            continue;
        }
        overrides[license.toLowerCase()] = category;
    }
    const exceptions = [];
    const exceptionsRaw = pol.exceptions;
    if (exceptionsRaw !== undefined) {
        if (!Array.isArray(exceptionsRaw)) {
            v.problems.push('policy.exceptions must be an array');
        }
        else {
            for (const [index, entry] of exceptionsRaw.entries()) {
                const name = entry?.package;
                const reason = entry?.reason;
                if (typeof name !== 'string' || name === '')
                    v.problems.push(`policy.exceptions[${index}].package is required`);
                // A reason is mandatory: an accepted risk must be explainable in an audit.
                if (typeof reason !== 'string' || reason.trim() === '')
                    v.problems.push(`policy.exceptions[${index}].reason is required`);
                if (typeof name === 'string' && typeof reason === 'string')
                    exceptions.push({ package: name, reason });
            }
        }
    }
    const guidelinesUrl = v.nullableString(pol, 'guidelinesUrl', 'policy');
    if (guidelinesUrl !== null && !isSafeServiceUrl(guidelinesUrl)) {
        v.problems.push('policy.guidelinesUrl must be an https URL without credentials');
    }
    const policy = {
        enabled: v.boolean(pol, 'enabled', 'policy', true),
        guidelinesUrl,
        projectType: v.oneOf(pol, 'projectType', 'policy', ['internal', 'distributed'], 'distributed'),
        // Default to the stricter reading: guidance that forbids the GPL family in
        // distributed software treats the Lesser GPL as strong copyleft too.
        ruleset: v.oneOf(pol, 'ruleset', 'policy', ['standard', 'conservative'], 'conservative'),
        failOn: v.oneOf(pol, 'failOn', 'policy', ['none', 'forbidden', 'review'], 'none'),
        overrides,
        exceptions,
    };
    const grd = v.object(root.guard, 'guard');
    const previous = v.nullableString(grd, 'previousDatasetPath', 'guard');
    const guard = {
        previousDatasetPath: previous === null ? null : resolve(baseDir, previous),
        maxPackageDropPercent: v.integer(grd, 'maxPackageDropPercent', 'guard', 30, 0, 100),
    };
    const concurrency = v.integer(root, 'concurrency', 'config', 4, 1, 32);
    if (v.problems.length > 0)
        throw new ConfigError(v.problems);
    return { source, relevance, extraction, enrichment, output, policy, guard, concurrency };
}
export async function loadConfig(path) {
    const absolute = resolve(path);
    let raw;
    try {
        raw = JSON.parse(await readFile(absolute, 'utf8'));
    }
    catch (error) {
        throw new ConfigError([`Could not read ${absolute}: ${error instanceof Error ? error.message : String(error)}`]);
    }
    return parseConfig(raw, dirname(absolute));
}
//# sourceMappingURL=config.js.map