// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { aggregatePackages, compareVersions } from '../src/aggregate/aggregate.js';
import { applyCurations, loadCurations } from '../src/enrich/curations.js';
import { extractCopyrights, normalizeDeclaredLicense, normalizeLicenseExpression, singleSpdxId } from '../src/enrich/license.js';
import { repositoryUrl, toSafeHttpUrl } from '../src/enrich/urls.js';
import { auditToMarkdown, buildAuditReport, checkPublishGuard, datasetToSpdx } from '../src/report/report.js';
import { ConfigError } from '../src/util/errors.js';
function pkg(overrides) {
    return {
        name: 'lib',
        version: '1.0.0',
        ecosystem: 'npm',
        purl: 'pkg:npm/lib@1.0.0',
        license: { expression: 'MIT', raw: 'MIT' },
        licenseText: 'MIT License',
        noticeText: null,
        copyrights: ['Copyright (c) 2020 Jane'],
        homepage: 'https://github.com/jane/lib',
        repositories: ['org/web'],
        flags: [],
        ...overrides,
    };
}
describe('normalizeLicenseExpression', () => {
    it('canonicalises identifiers, aliases and operators', () => {
        assert.equal(normalizeLicenseExpression('mit').expression, 'MIT');
        assert.equal(normalizeLicenseExpression('Apache 2.0').expression, 'Apache-2.0');
        assert.equal(normalizeLicenseExpression('(mit or apache-2.0)').expression, '(MIT OR Apache-2.0)');
        assert.equal(normalizeLicenseExpression('GPL-2.0 WITH Classpath-exception-2.0').expression, 'GPL-2.0-only WITH Classpath-exception-2.0');
        assert.equal(normalizeLicenseExpression('LGPL-2.1+').expression, 'LGPL-2.1-or-later');
        assert.equal(normalizeLicenseExpression('Apache-2.0+').expression, 'Apache-2.0+');
    });
    it('flags values that are not SPDX', () => {
        const seeFile = normalizeLicenseExpression('SEE LICENSE IN LICENSE.txt');
        assert.equal(seeFile.expression, null);
        assert.deepEqual(seeFile.flags, ['LICENSE_NON_SPDX']);
        assert.deepEqual(normalizeLicenseExpression('UNLICENSED').flags, ['LICENSE_UNKNOWN']);
        assert.equal(normalizeLicenseExpression('MIT AND').expression, null);
        assert.deepEqual(normalizeLicenseExpression('Some-Custom-1.0').flags, ['LICENSE_NON_SPDX']);
    });
    it('supports legacy npm license arrays', () => {
        assert.equal(normalizeDeclaredLicense([{ type: 'MIT' }, { type: 'Apache-2.0' }]).expression, '(MIT) OR (Apache-2.0)');
        assert.equal(normalizeDeclaredLicense({ type: 'BSD-3-Clause' }).expression, 'BSD-3-Clause');
        assert.deepEqual(normalizeDeclaredLicense(undefined).flags, ['LICENSE_UNKNOWN']);
    });
    it('links only simple, known identifiers', () => {
        assert.equal(singleSpdxId('MIT'), 'MIT');
        assert.equal(singleSpdxId('MIT OR Apache-2.0'), null);
        assert.equal(singleSpdxId('Made-Up-1.0'), null);
    });
});
describe('extractCopyrights', () => {
    it('keeps real statements, drops template lines and emails', () => {
        const text = [
            'MIT License',
            '',
            'Copyright (c) 2014-2024 Jane Doe <jane@example.com>',
            ' * Copyright 2019 Example GmbH',
            'The above copyright notice and this permission notice shall be included',
            'Copyright [yyyy] [name of copyright owner]',
            'COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM',
        ].join('\n');
        assert.deepEqual(extractCopyrights(text, { stripEmails: true }), ['Copyright (c) 2014-2024 Jane Doe', 'Copyright 2019 Example GmbH']);
        assert.deepEqual(extractCopyrights(text, { stripEmails: false })[0], 'Copyright (c) 2014-2024 Jane Doe <jane@example.com>');
    });
});
describe('URLs', () => {
    it('only accepts http(s) without credentials', () => {
        assert.equal(toSafeHttpUrl('javascript:alert(1)'), null);
        assert.equal(toSafeHttpUrl('data:text/html,hi'), null);
        assert.equal(toSafeHttpUrl('https://user:secret@example.com/x'), 'https://example.com/x');
    });
    it('normalises package.json repository values', () => {
        assert.equal(repositoryUrl('git+https://github.com/facebook/react.git'), 'https://github.com/facebook/react');
        assert.equal(repositoryUrl({ type: 'git', url: 'git@github.com:lodash/lodash.git' }), 'https://github.com/lodash/lodash');
        assert.equal(repositoryUrl('github:sindresorhus/chalk'), 'https://github.com/sindresorhus/chalk');
        assert.equal(repositoryUrl('expressjs/express'), 'https://github.com/expressjs/express');
        assert.equal(repositoryUrl('javascript:alert(1)'), null);
    });
});
describe('aggregatePackages', () => {
    it('deduplicates across repositories and versions, keeping versions internal', () => {
        const result = aggregatePackages([
            pkg({ version: '1.0.0', repositories: ['org/web'], copyrights: ['Copyright 2020 Jane'] }),
            pkg({ version: '1.10.0', repositories: ['org/app'], copyrights: ['Copyright 2024 Jane'], licenseText: 'MIT License v2' }),
            pkg({ version: '1.2.0', repositories: ['org/web'] }),
        ]);
        assert.equal(result.length, 1);
        const entry = result[0];
        assert.deepEqual(entry?.versions, ['1.0.0', '1.2.0', '1.10.0']);
        assert.deepEqual(entry?.repositories, ['org/app', 'org/web']);
        assert.equal(entry?.licenseText, 'MIT License v2', 'text from the newest version');
        assert.deepEqual(entry?.copyrights, ['Copyright 2024 Jane', 'Copyright (c) 2020 Jane', 'Copyright 2020 Jane']);
        assert.equal(entry?.id, 'lib');
    });
    it('keeps separate entries when a license changed between versions, with unique ids', () => {
        const result = aggregatePackages([
            pkg({ version: '1.0.0' }),
            pkg({ version: '2.0.0', license: { expression: 'Apache-2.0', raw: 'Apache-2.0' } }),
        ]);
        assert.equal(result.length, 2);
        assert.deepEqual(result.map((entry) => entry.id).sort(), ['lib-npm-apache-2-0', 'lib-npm-mit']);
    });
    it('compares versions numerically', () => {
        assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
        assert.ok(compareVersions('2.0.0-beta.1', '2.0.0') < 0);
    });
});
describe('curations', () => {
    it('loads, validates and applies curations and additions', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'opencredits-cur-'));
        try {
            await writeFile(join(dir, 'getopt-LICENSE.txt'), 'Copyright (c) 1987 The Regents\nRedistribution permitted.');
            await writeFile(join(dir, 'curations.json'), JSON.stringify({
                curations: [
                    { match: { name: 'lib' }, set: { copyrights: ['Copyright 2020 Jane Doe'] }, reason: 'Author confirmed in README' },
                    { match: { name: 'internal-tool' }, exclude: true, reason: 'Build tool, not shipped' },
                ],
                additions: [
                    {
                        name: 'getopt',
                        license: 'BSD-3-Clause',
                        copyrights: ['Copyright (c) 1987 The Regents of the University of California'],
                        homepage: 'https://cvsweb.netbsd.org/',
                        licenseTextFile: 'getopt-LICENSE.txt',
                        reason: 'Vendored into src/vendor/getopt.c',
                    },
                ],
            }));
            const curations = await loadCurations(join(dir, 'curations.json'));
            const result = applyCurations([pkg({ flags: ['COPYRIGHT_MISSING'], copyrights: [] }), pkg({ name: 'internal-tool' })], curations);
            assert.equal(result.length, 2);
            assert.deepEqual(result[0]?.copyrights, ['Copyright 2020 Jane Doe']);
            assert.deepEqual(result[0]?.flags, ['CURATED']);
            assert.equal(result[1]?.name, 'getopt');
            assert.ok(result[1]?.flags.includes('MANUALLY_ADDED'));
            assert.match(result[1]?.licenseText ?? '', /Redistribution permitted/);
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
    it('rejects entries without a reason and license files outside the directory', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'opencredits-cur-'));
        try {
            await writeFile(join(dir, 'curations.json'), JSON.stringify({
                curations: [{ match: { name: 'x' }, set: {} }],
                additions: [{ name: 'y', license: 'MIT', licenseTextFile: '../../etc/passwd', reason: 'r' }],
            }));
            await assert.rejects(loadCurations(join(dir, 'curations.json')), (error) => {
                assert.ok(error instanceof ConfigError);
                assert.ok(error.problems.some((problem) => problem.includes('reason is required')));
                assert.ok(error.problems.some((problem) => problem.includes('licenseTextFile')));
                return true;
            });
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
describe('reports', () => {
    const dataset = {
        schemaVersion: '1.0',
        generatedAt: '2026-09-16T02:00:00.000Z',
        tool: { name: 'opencredits', version: '0.1.0' },
        packages: aggregatePackages([pkg({}), pkg({ name: 'other', flags: ['LICENSE_TEXT_MISSING'], licenseText: null })]),
    };
    it('blocks publishing when the package count drops too far', () => {
        const smaller = { ...dataset, packages: dataset.packages.slice(0, 1) };
        assert.equal(checkPublishGuard(dataset, smaller, 30).ok, false);
        assert.equal(checkPublishGuard(dataset, smaller, 60).ok, true);
        assert.equal(checkPublishGuard(null, smaller, 0).ok, true);
    });
    it('lists packages needing review and escapes markdown tables', () => {
        const audit = buildAuditReport(new Date(), new Date(), [
            { repository: 'org/bad|repo', status: 'failed', reasons: [], commitSha: null, packageCount: 0, extractors: [], error: 'HTTP 500' },
        ], dataset.packages, []);
        assert.equal(audit.summary.packagesNeedingReview, 1);
        assert.match(auditToMarkdown(audit), /org\/bad\\\|repo/);
    });
    it('exports an SPDX 2.3 document', () => {
        const spdx = datasetToSpdx(dataset, 'test');
        assert.equal(spdx.spdxVersion, 'SPDX-2.3');
        assert.equal(spdx.packages.length, 2);
    });
});
//# sourceMappingURL=data.test.js.map