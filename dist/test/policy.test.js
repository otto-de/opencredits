// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from '../src/config/config.js';
import { classifyLicense, evaluatePolicy } from '../src/policy/policy.js';
import { auditToMarkdown, buildAuditReport } from '../src/report/report.js';
import { ConfigError } from '../src/util/errors.js';
const base = parseConfig({}, '/tmp').policy;
function options(overrides = {}) {
    return { ...base, ...overrides };
}
function pkg(name, expression, raw = expression) {
    return {
        id: name,
        name,
        ecosystem: 'npm',
        license: { expression, raw },
        licenseText: 'text',
        noticeText: null,
        copyrights: ['Copyright (c) 2024 Someone'],
        homepage: null,
        versions: ['1.0.0'],
        purls: [`pkg:npm/${name}@1.0.0`],
        repositories: ['acme/web'],
        flags: [],
    };
}
function categoryOf(expression, raw = expression, opts = {}) {
    return classifyLicense({ expression, raw }, options(opts));
}
describe('license classification', () => {
    it('classifies the common license families', () => {
        assert.equal(categoryOf('MIT'), 'permissive');
        assert.equal(categoryOf('Apache-2.0'), 'permissive');
        assert.equal(categoryOf('MPL-2.0'), 'weak-copyleft');
        assert.equal(categoryOf('EPL-2.0'), 'weak-copyleft');
        assert.equal(categoryOf('GPL-3.0-only'), 'strong-copyleft');
        assert.equal(categoryOf('AGPL-3.0-or-later'), 'network-copyleft');
        assert.equal(categoryOf('SSPL-1.0'), 'network-copyleft');
        assert.equal(categoryOf('EUPL-1.2'), 'network-copyleft');
        assert.equal(categoryOf('CPAL-1.0'), 'network-copyleft');
        assert.equal(categoryOf('RPL-1.5'), 'network-copyleft');
        assert.equal(categoryOf('Elastic-2.0'), 'case-by-case');
        assert.equal(categoryOf(null, null), 'unknown');
    });
    it('moves the Lesser GPL between categories with the ruleset', () => {
        assert.equal(categoryOf('LGPL-2.1-only'), 'strong-copyleft', 'the conservative ruleset is the default');
        assert.equal(categoryOf('LGPL-2.1-only', 'LGPL-2.1-only', { ruleset: 'standard' }), 'weak-copyleft');
    });
    it('detects non-free wrappers and unlicensed code from raw text', () => {
        assert.equal(categoryOf(null, 'MIT with Commons Clause'), 'non-free');
        assert.equal(categoryOf(null, 'UNLICENSED'), 'non-free');
        assert.equal(categoryOf(null, 'All rights reserved'), 'non-free');
        assert.equal(categoryOf('LicenseRef-Commons-Clause'), 'non-free');
    });
    it('evaluates SPDX expressions by operator', () => {
        assert.equal(categoryOf('(MIT OR GPL-3.0-only)'), 'permissive', 'OR is a choice, so the mildest option counts');
        assert.equal(categoryOf('MIT AND GPL-3.0-only'), 'strong-copyleft', 'AND means all obligations apply');
        assert.equal(categoryOf('GPL-2.0-only WITH Classpath-exception-2.0'), 'strong-copyleft');
        assert.equal(categoryOf('(MIT AND AGPL-3.0-only) OR Apache-2.0'), 'permissive');
        assert.equal(categoryOf('MIT OR Some-Unknown-1.0'), 'permissive');
        assert.equal(categoryOf('MIT AND Some-Unknown-1.0'), 'unknown');
    });
    it('applies configured overrides', () => {
        assert.equal(categoryOf('MPL-2.0', 'MPL-2.0', { overrides: { 'mpl-2.0': 'strong-copyleft' } }), 'strong-copyleft');
        assert.equal(categoryOf('Odd-Internal-1.0', 'Odd-Internal-1.0', { overrides: { 'odd-internal-1.0': 'permissive' } }), 'permissive');
    });
});
describe('policy evaluation', () => {
    const packages = [
        pkg('react', 'MIT'),
        pkg('mpl-lib', 'MPL-2.0'),
        pkg('gpl-lib', 'GPL-3.0-only'),
        pkg('agpl-lib', 'AGPL-3.0-only'),
        pkg('elastic-lib', 'Elastic-2.0'),
        pkg('mystery-lib', null, null),
    ];
    it('forbids copyleft for distributed software but allows it internally', () => {
        const distributed = evaluatePolicy(packages, options({ projectType: 'distributed' }));
        const byName = Object.fromEntries(distributed.findings.map((finding) => [finding.name, finding.verdict]));
        assert.deepEqual(byName, { 'agpl-lib': 'forbidden', 'gpl-lib': 'forbidden', 'elastic-lib': 'review', 'mystery-lib': 'review' });
        assert.equal(distributed.counts.permissive, 1);
        assert.equal(distributed.counts['weak-copyleft'], 1, 'weak copyleft is allowed and raises no finding');
        const internal = evaluatePolicy(packages, options({ projectType: 'internal' }));
        assert.equal(internal.findings.find((finding) => finding.name === 'gpl-lib')?.verdict, undefined);
        assert.equal(internal.findings.find((finding) => finding.name === 'agpl-lib')?.verdict, 'forbidden', 'network copyleft is forbidden everywhere');
    });
    it('decides what blocks according to failOn, and honours exceptions', () => {
        assert.deepEqual(evaluatePolicy(packages, options({ failOn: 'none' })).blocking, []);
        assert.deepEqual(evaluatePolicy(packages, options({ failOn: 'forbidden' })).blocking.map((finding) => finding.name), ['agpl-lib', 'gpl-lib']);
        assert.equal(evaluatePolicy(packages, options({ failOn: 'review' })).blocking.length, 4);
        const accepted = evaluatePolicy(packages, options({ failOn: 'forbidden', exceptions: [{ package: 'GPL-LIB', reason: 'Build-time only, approved by legal on 2026-10-01' }] }));
        assert.deepEqual(accepted.blocking.map((finding) => finding.name), ['agpl-lib']);
        assert.match(accepted.findings.find((finding) => finding.name === 'gpl-lib')?.acceptedReason ?? '', /approved by legal/);
    });
    it('points the report at the organisation\'s own guidelines when configured', () => {
        const url = 'https://github.example.com/opensource/blob/main/_docs/licensing.md';
        const withGuidelines = auditToMarkdown(buildAuditReport(new Date(), new Date(), [], [], [], evaluatePolicy(packages, options({ guidelinesUrl: url }))));
        assert.match(withGuidelines, /Categories follow your license guidelines: https:\/\/github\.example\.com/);
        const withoutGuidelines = auditToMarkdown(buildAuditReport(new Date(), new Date(), [], [], [], evaluatePolicy(packages, options())));
        assert.match(withoutGuidelines, /this tool's defaults/);
        assert.throws(() => parseConfig({ policy: { guidelinesUrl: 'javascript:alert(1)' } }, '/tmp'), /guidelinesUrl must be an https URL/);
    });
    it('explains each finding in the audit summary', () => {
        const policy = evaluatePolicy(packages, options({ failOn: 'forbidden' }));
        const markdown = auditToMarkdown(buildAuditReport(new Date(), new Date(), [], [], [], policy));
        assert.match(markdown, /### License policy/);
        assert.match(markdown, /\| agpl-lib \| AGPL-3\.0-only \| Network copyleft \| forbidden \| no \|/);
        assert.match(markdown, /2 package\(s\) violate the configured policy/);
        assert.match(policy.findings[0]?.explanation ?? '', /offered as a service/);
    });
});
describe('policy configuration', () => {
    it('defaults to reporting without failing the build', () => {
        assert.deepEqual(base, {
            enabled: true,
            guidelinesUrl: null,
            projectType: 'distributed',
            ruleset: 'conservative',
            failOn: 'none',
            overrides: {},
            exceptions: [],
        });
    });
    it('requires a reason for every exception and rejects unknown categories', () => {
        assert.throws(() => parseConfig({ policy: { exceptions: [{ package: 'x' }], overrides: { MIT: 'fine' }, failOn: 'always' } }, '/tmp'), (error) => {
            assert.ok(error instanceof ConfigError);
            const text = error.problems.join('\n');
            assert.match(text, /policy\.exceptions\[0\]\.reason is required/);
            assert.match(text, /policy\.overrides\.MIT must be one of/);
            assert.match(text, /policy\.failOn must be one of/);
            return true;
        });
    });
});
//# sourceMappingURL=policy.test.js.map