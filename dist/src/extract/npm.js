// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '../util/log.js';
import { npmPurl } from '../util/purl.js';
import { findFiles } from './types.js';
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
const MAX_LOCKFILE_BYTES = 100 * 1024 * 1024;
function licenseField(entry) {
    return typeof entry.license === 'string' ? entry.license : undefined;
}
/** Resolves "npm:real-name@1.2.3" aliases used in lockfile v1. */
function resolveAlias(name, version) {
    if (version.startsWith('npm:')) {
        const spec = version.slice(4);
        const at = spec.lastIndexOf('@');
        if (at > 0)
            return { name: spec.slice(0, at), version: spec.slice(at + 1) };
    }
    return { name, version };
}
function isRegistryVersion(version) {
    return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}
/**
 * Parses package-lock.json / npm-shrinkwrap.json (lockfileVersion 1, 2 and 3).
 * Dev dependencies are skipped unless includeDev is set. "devOptional" packages
 * are kept: over-reporting a notice is safer than omitting one.
 */
export function parseNpmLockfile(lock, includeDev) {
    if (typeof lock !== 'object' || lock === null)
        return [];
    const root = lock;
    const found = new Map();
    const add = (rawName, entry) => {
        if (typeof entry.version !== 'string')
            return;
        if (entry.dev === true && !includeDev)
            return;
        if (entry.extraneous === true || entry.link === true)
            return;
        const { name, version } = resolveAlias(typeof entry.name === 'string' ? entry.name : rawName, entry.version);
        if (!NPM_NAME.test(name)) {
            log.warn('Skipping npm package with invalid name', { name });
            return;
        }
        if (!isRegistryVersion(version)) {
            log.debug('Skipping non-registry npm dependency', { name, version });
            return;
        }
        const pkg = { name, version };
        if (typeof entry.integrity === 'string')
            pkg.integrity = entry.integrity;
        const license = licenseField(entry);
        if (license !== undefined)
            pkg.license = license;
        found.set(`${name}@${version}`, pkg);
    };
    if (typeof root.packages === 'object' && root.packages !== null) {
        for (const [key, value] of Object.entries(root.packages)) {
            const marker = key.lastIndexOf('node_modules/');
            // "" is the root project; keys without node_modules are workspace sources.
            if (marker < 0)
                continue;
            add(key.slice(marker + 'node_modules/'.length), value);
        }
    }
    else if (typeof root.dependencies === 'object' && root.dependencies !== null) {
        const walk = (deps) => {
            for (const [name, entry] of Object.entries(deps)) {
                add(name, entry);
                if (typeof entry.dependencies === 'object' && entry.dependencies !== null) {
                    walk(entry.dependencies);
                }
            }
        };
        walk(root.dependencies);
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
export const npmExtractor = {
    name: 'npm',
    ecosystems: ['npm'],
    async extract(rootDir, context) {
        const lockfiles = await findFiles(rootDir, (name) => name === 'package-lock.json' || name === 'npm-shrinkwrap.json');
        const results = [];
        for (const manifestPath of lockfiles) {
            const full = join(rootDir, manifestPath);
            if ((await stat(full)).size > MAX_LOCKFILE_BYTES) {
                log.warn('Skipping oversized lockfile', { manifestPath });
                continue;
            }
            let parsed;
            try {
                parsed = JSON.parse(await readFile(full, 'utf8'));
            }
            catch {
                log.warn('Skipping unparsable lockfile', { manifestPath });
                continue;
            }
            for (const pkg of parseNpmLockfile(parsed, context.includeDevDependencies)) {
                const record = {
                    name: pkg.name,
                    version: pkg.version,
                    ecosystem: 'npm',
                    purl: npmPurl(pkg.name, pkg.version),
                    manifestPath,
                    extractor: 'npm',
                };
                if (pkg.license !== undefined)
                    record.declaredLicense = pkg.license;
                if (pkg.integrity !== undefined)
                    record.integrity = pkg.integrity;
                results.push(record);
            }
        }
        return results;
    },
};
//# sourceMappingURL=npm.js.map