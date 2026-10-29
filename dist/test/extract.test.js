// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { npmExtractor, parseNpmLockfile } from '../src/extract/npm.js';
import { parseSpdxDocument } from '../src/extract/syft.js';
import { isManifestPath } from '../src/extract/types.js';
import { parsePurl, npmPurl } from '../src/util/purl.js';
const LOCK_V3 = {
    name: 'shop-frontend',
    lockfileVersion: 3,
    packages: {
        '': { name: 'shop-frontend', version: '1.0.0' },
        'node_modules/react': { version: '18.3.1', integrity: 'sha512-abc', license: 'MIT' },
        'node_modules/@babel/core': { version: '7.24.0', dev: true, license: 'MIT' },
        'node_modules/@scope/widget': { version: '2.0.0', license: 'Apache-2.0' },
        'node_modules/a/node_modules/react': { version: '17.0.2', license: 'MIT' },
        'node_modules/fsevents': { version: '2.3.3', devOptional: true, optional: true, license: 'MIT' },
        'node_modules/alias-pkg': { name: 'real-pkg', version: '1.2.3', license: 'ISC' },
        'node_modules/local-link': { resolved: 'packages/ui', link: true },
        'packages/ui': { name: '@shop/ui', version: '0.0.1' },
        'node_modules/git-dep': { version: 'git+ssh://git@github.com/x/y.git#abc' },
    },
};
describe('parseNpmLockfile', () => {
    it('reads lockfile v3 production dependencies', () => {
        const names = parseNpmLockfile(LOCK_V3, false).map((pkg) => `${pkg.name}@${pkg.version}`);
        assert.deepEqual(names, ['@scope/widget@2.0.0', 'fsevents@2.3.3', 'react@17.0.2', 'react@18.3.1', 'real-pkg@1.2.3']);
    });
    it('includes dev dependencies when asked', () => {
        assert.ok(parseNpmLockfile(LOCK_V3, true).some((pkg) => pkg.name === '@babel/core'));
    });
    it('reads lockfile v1 nested dependencies and aliases', () => {
        const lock = {
            lockfileVersion: 1,
            dependencies: {
                lodash: { version: '4.17.21', integrity: 'sha512-x' },
                jest: { version: '29.0.0', dev: true },
                wrapper: { version: 'npm:real-name@3.1.0', dependencies: { inner: { version: '1.0.0' } } },
            },
        };
        assert.deepEqual(parseNpmLockfile(lock, false).map((pkg) => `${pkg.name}@${pkg.version}`), ['inner@1.0.0', 'lodash@4.17.21', 'real-name@3.1.0']);
    });
    it('ignores invalid input and invalid package names', () => {
        assert.deepEqual(parseNpmLockfile(null, false), []);
        assert.deepEqual(parseNpmLockfile({ packages: { 'node_modules/<script>': { version: '1.0.0' } } }, false), []);
    });
});
describe('npmExtractor', () => {
    it('finds lockfiles in a tree without following symlinks or node_modules', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'opencredits-npm-'));
        try {
            await mkdir(join(dir, 'apps/web'), { recursive: true });
            await mkdir(join(dir, 'node_modules/x'), { recursive: true });
            await writeFile(join(dir, 'apps/web/package-lock.json'), JSON.stringify(LOCK_V3));
            await writeFile(join(dir, 'node_modules/x/package-lock.json'), JSON.stringify(LOCK_V3));
            await symlink(join(dir, 'apps'), join(dir, 'loop'));
            const records = await npmExtractor.extract(dir, { includeDevDependencies: false, handledEcosystems: new Set() });
            assert.equal(new Set(records.map((record) => record.manifestPath)).size, 1);
            assert.equal(records[0]?.manifestPath, 'apps/web/package-lock.json');
            assert.equal(records.find((record) => record.name === '@scope/widget')?.purl, 'pkg:npm/%40scope/widget@2.0.0');
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
describe('parseSpdxDocument', () => {
    const doc = {
        spdxVersion: 'SPDX-2.3',
        packages: [
            { name: 'repo', SPDXID: 'SPDXRef-DocumentRoot-Directory' },
            {
                name: 'slf4j-api',
                versionInfo: '2.0.13',
                licenseDeclared: 'MIT',
                homepage: 'https://www.slf4j.org',
                sourceInfo: 'acquired package info from Java archive: /service/pom.xml',
                externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:maven/org.slf4j/slf4j-api@2.0.13' }],
            },
            {
                name: 'github.com/google/uuid',
                versionInfo: 'v1.6.0',
                licenseDeclared: 'NOASSERTION',
                downloadLocation: 'javascript:alert(1)',
                externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:golang/github.com/google/uuid@v1.6.0' }],
            },
            {
                name: 'react',
                versionInfo: '18.3.1',
                externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/react@18.3.1' }],
            },
        ],
    };
    it('maps packages and skips ecosystems owned by other extractors', () => {
        const records = parseSpdxDocument(doc, new Set(['npm']));
        assert.equal(records.length, 2);
        const maven = records[0];
        assert.equal(maven?.name, 'org.slf4j:slf4j-api');
        assert.equal(maven?.ecosystem, 'maven');
        assert.equal(maven?.declaredLicense, 'MIT');
        assert.equal(maven?.manifestPath, 'service/pom.xml');
        const golang = records[1];
        assert.equal(golang?.name, 'github.com/google/uuid');
        assert.equal(golang?.declaredLicense, undefined);
        assert.equal(golang?.homepage, undefined, 'non-http download locations are dropped');
    });
});
describe('purl helpers', () => {
    it('round-trips scoped npm names', () => {
        const purl = parsePurl(npmPurl('@types/node', '22.0.0'));
        assert.deepEqual(purl, { type: 'npm', namespace: '@types', name: 'node', version: '22.0.0' });
    });
    it('rejects malformed purls', () => {
        assert.equal(parsePurl('npm/react'), null);
        assert.equal(parsePurl('pkg:'), null);
    });
});
describe('isManifestPath', () => {
    it('recognises manifests across ecosystems', () => {
        for (const path of ['package-lock.json', 'svc/go.mod', 'app/build.gradle.kts', 'requirements-prod.txt', 'src/App.csproj', 'Cargo.lock']) {
            assert.equal(isManifestPath(path), true, path);
        }
        for (const path of ['src/index.ts', 'node_modules/x/package.json', 'README.md']) {
            assert.equal(isManifestPath(path), false, path);
        }
    });
});
//# sourceMappingURL=extract.test.js.map