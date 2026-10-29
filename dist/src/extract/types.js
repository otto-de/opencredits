// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
/** Thrown when an extractor's external tool is not installed. */
export class ExtractorUnavailableError extends Error {
    name = 'ExtractorUnavailableError';
}
const MANIFEST_NAMES = new Set([
    // JavaScript
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
    // JVM
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'gradle.lockfile',
    'build.sbt',
    // Go
    'go.mod',
    'go.sum',
    // Python
    'Pipfile.lock',
    'poetry.lock',
    'pyproject.toml',
    'uv.lock',
    'setup.py',
    'setup.cfg',
    'pdm.lock',
    // Ruby, PHP, Rust, .NET, Swift, Dart, Elixir, C/C++
    'Gemfile.lock',
    'composer.lock',
    'Cargo.lock',
    'packages.lock.json',
    'packages.config',
    'Podfile.lock',
    'Package.resolved',
    'pubspec.lock',
    'mix.lock',
    'conanfile.txt',
    'conan.lock',
    'vcpkg.json',
].map((name) => name.toLowerCase()));
const MANIFEST_PATTERNS = [/^requirements[^/]*\.txt$/i, /\.(?:cs|fs|vb)proj$/i, /\.gemspec$/i];
const IGNORED_SEGMENTS = new Set(['node_modules', '.git']);
/** True for dependency manifests and lockfiles that SBOM tooling can read statically. */
export function isManifestPath(path) {
    const segments = path.split('/');
    if (segments.some((segment) => IGNORED_SEGMENTS.has(segment)))
        return false;
    const base = segments[segments.length - 1] ?? '';
    return MANIFEST_NAMES.has(base.toLowerCase()) || MANIFEST_PATTERNS.some((pattern) => pattern.test(base));
}
/** Recursively finds files by name, never following symlinks and skipping node_modules and .git. */
export async function findFiles(rootDir, match) {
    const found = [];
    async function walk(dir) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isSymbolicLink())
                continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_SEGMENTS.has(entry.name))
                    await walk(full);
            }
            else if (entry.isFile() && match(entry.name)) {
                found.push(relative(rootDir, full).split('\\').join('/'));
            }
        }
    }
    await walk(rootDir);
    return found.sort();
}
//# sourceMappingURL=types.js.map