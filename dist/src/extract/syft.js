// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { displayName, parsePurl } from '../util/purl.js';
import { ExtractorUnavailableError } from './types.js';
const execFileAsync = promisify(execFile);
function sourcePath(sourceInfo) {
    if (typeof sourceInfo !== 'string')
        return '';
    const index = sourceInfo.lastIndexOf(': ');
    if (index < 0)
        return '';
    return sourceInfo
        .slice(index + 2)
        .split(',')[0]
        .trim()
        .replace(/^\/+/, '');
}
function spdxValue(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed === '' || trimmed === 'NOASSERTION' || trimmed === 'NONE' ? undefined : trimmed;
}
function httpUrl(value) {
    const candidate = spdxValue(value);
    return candidate !== undefined && /^https?:\/\//i.test(candidate) ? candidate : undefined;
}
/** Converts an SPDX 2.x JSON document produced by Syft into dependency records. */
export function parseSpdxDocument(document, skipEcosystems) {
    if (typeof document !== 'object' || document === null)
        return [];
    const packages = document.packages;
    if (!Array.isArray(packages))
        return [];
    const results = [];
    for (const pkg of packages) {
        const refs = Array.isArray(pkg.externalRefs) ? pkg.externalRefs : [];
        const locator = refs.find((ref) => ref.referenceType === 'purl')?.referenceLocator;
        if (typeof locator !== 'string')
            continue;
        const purl = parsePurl(locator);
        if (purl === null || skipEcosystems.has(purl.type))
            continue;
        const version = purl.version ?? spdxValue(pkg.versionInfo);
        if (version === undefined)
            continue;
        const record = {
            name: displayName(purl),
            version,
            ecosystem: purl.type,
            purl: locator,
            manifestPath: sourcePath(pkg.sourceInfo),
            extractor: 'syft',
        };
        const license = spdxValue(pkg.licenseDeclared) ?? spdxValue(pkg.licenseConcluded);
        if (license !== undefined)
            record.declaredLicense = license;
        const homepage = httpUrl(pkg.homepage) ?? httpUrl(pkg.downloadLocation);
        if (homepage !== undefined)
            record.homepage = homepage;
        results.push(record);
    }
    return results;
}
export function createSyftExtractor(options) {
    return {
        name: 'syft',
        ecosystems: [],
        async extract(rootDir, context) {
            let stdout;
            try {
                // Arguments are passed as an array (no shell). The child gets a minimal
                // environment so credentials such as GITHUB_TOKEN never reach it.
                const result = await execFileAsync(options.syftPath, ['scan', `dir:${rootDir}`, '--output', 'spdx-json', '--quiet'], {
                    timeout: options.timeoutSeconds * 1000,
                    maxBuffer: 512 * 1024 * 1024,
                    env: {
                        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
                        HOME: process.env.TMPDIR ?? '/tmp',
                        TMPDIR: process.env.TMPDIR ?? '/tmp',
                        SYFT_CHECK_FOR_APP_UPDATE: 'false',
                    },
                });
                stdout = result.stdout;
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    throw new ExtractorUnavailableError(`Syft executable not found at "${options.syftPath}"`);
                }
                throw error;
            }
            return parseSpdxDocument(JSON.parse(stdout), context.handledEcosystems);
        },
    };
}
//# sourceMappingURL=syft.js.map