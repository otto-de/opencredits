// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Severity order. OR picks the least severe operand (a choice of licenses),
 * AND picks the most severe (all obligations apply).
 */
const SEVERITY = {
    permissive: 0,
    'weak-copyleft': 1,
    'strong-copyleft': 2,
    'case-by-case': 3,
    unknown: 4,
    'network-copyleft': 5,
    'non-free': 6,
};
const PERMISSIVE = [
    '0BSD', 'AFL-1.1', 'AFL-1.2', 'AFL-2.0', 'AFL-2.1', 'AFL-3.0', 'Apache-1.1', 'Apache-2.0', 'Artistic-2.0',
    'BlueOak-1.0.0', 'BSD-1-Clause', 'BSD-2-Clause', 'BSD-2-Clause-Patent', 'BSD-3-Clause', 'BSD-3-Clause-Clear',
    'BSD-4-Clause', 'BSL-1.0', 'bzip2-1.0.6', 'CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'curl', 'FTL', 'ICU', 'IJG',
    'ISC', 'JSON', 'libpng-2.0', 'MIT', 'MIT-0', 'MIT-CMU', 'MS-PL', 'MulanPSL-2.0', 'NCSA', 'OFL-1.0', 'OFL-1.1',
    'OpenSSL', 'PHP-3.01', 'PostgreSQL', 'PSF-2.0', 'Python-2.0', 'Ruby', 'Unicode-3.0', 'Unicode-DFS-2016',
    'Unlicense', 'UPL-1.0', 'Vim', 'W3C', 'WTFPL', 'X11', 'Zlib', 'ZPL-2.1',
];
const WEAK_COPYLEFT = [
    'APSL-1.0', 'APSL-2.0', 'Artistic-1.0', 'CDDL-1.0', 'CDDL-1.1', 'CECILL-C', 'CPL-1.0', 'EPL-1.0', 'EPL-2.0',
    'IPL-1.0', 'MPL-1.1', 'MPL-2.0', 'MPL-2.0-no-copyleft-exception', 'MS-RL', 'ODbL-1.0', 'Sleepycat',
];
const STRONG_COPYLEFT = [
    'BCL', 'CECILL-2.1', 'GPL-1.0-only', 'GPL-1.0-or-later', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only',
    'GPL-3.0-or-later', 'NPL-1.0', 'NPL-1.1', 'OSL-1.0', 'OSL-2.0', 'OSL-2.1', 'OSL-3.0', 'QPL-1.0',
];
/** Lesser GPL: weak copyleft in the standard ruleset, strong in the conservative one. */
const LESSER_GPL = [
    'LGPL-2.0-only', 'LGPL-2.0-or-later', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later',
];
/** Copyleft that triggers on network use, so it reaches hosted services too. */
const NETWORK_COPYLEFT = [
    'AGPL-1.0-only', 'AGPL-1.0-or-later', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'CPAL-1.0', 'EUPL-1.0', 'EUPL-1.1',
    'EUPL-1.2', 'RPL-1.1', 'RPL-1.5', 'SSPL-1.0',
];
/** Not open source: use is restricted beyond what an OSI licence allows. */
const NON_FREE = ['Commons-Clause', 'BUSL-1.1', 'Polyform-Noncommercial-1.0.0', 'Polyform-Shield-1.0.0', 'SSPL-1.0-US'];
const CASE_BY_CASE = ['Elastic-2.0', 'Elastic-License-2.0', 'ELv2'];
function buildCategories(ruleset) {
    const map = new Map();
    const add = (ids, category) => {
        for (const id of ids)
            map.set(id.toLowerCase(), category);
    };
    add(PERMISSIVE, 'permissive');
    add(WEAK_COPYLEFT, 'weak-copyleft');
    add(STRONG_COPYLEFT, 'strong-copyleft');
    add(LESSER_GPL, ruleset === 'conservative' ? 'strong-copyleft' : 'weak-copyleft');
    add(NETWORK_COPYLEFT, 'network-copyleft');
    add(NON_FREE, 'non-free');
    add(CASE_BY_CASE, 'case-by-case');
    return map;
}
const NON_FREE_TEXT = /commons[\s_-]*clause|non-?commercial|all[\s_-]+rights[\s_-]+reserved|proprietary|\bunlicensed\b/i;
const ELASTIC_TEXT = /elastic\s*licen[cs]e|\belv2\b/i;
/** Classifies one license identifier (not a whole expression). */
function classifyId(id, categories, overrides) {
    const key = id.toLowerCase();
    const override = overrides[key] ?? overrides[key.replace(/\+$/, '')];
    if (override !== undefined)
        return override;
    const direct = categories.get(key) ?? categories.get(key.replace(/\+$/, ''));
    if (direct !== undefined)
        return direct;
    if (ELASTIC_TEXT.test(id))
        return 'case-by-case';
    if (NON_FREE_TEXT.test(id))
        return 'non-free';
    return 'unknown';
}
/**
 * Evaluates an SPDX expression to a single category.
 * OR takes the least severe operand, AND the most severe, and WITH keeps the
 * category of the license the exception applies to.
 */
export function classifyExpression(expression, categories, overrides) {
    const tokens = expression.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter((t) => t !== '');
    let position = 0;
    const parsePrimary = () => {
        const token = tokens[position];
        if (token === undefined)
            return 'unknown';
        position += 1;
        if (token === '(') {
            const inner = parseOr();
            if (tokens[position] === ')')
                position += 1;
            return inner;
        }
        let category = classifyId(token, categories, overrides);
        while (tokens[position]?.toUpperCase() === 'WITH') {
            position += 2; // skip WITH and the exception identifier
        }
        if (category === 'unknown' && /^(?:LicenseRef|DocumentRef)-/i.test(token)) {
            category = ELASTIC_TEXT.test(token) ? 'case-by-case' : NON_FREE_TEXT.test(token) ? 'non-free' : 'unknown';
        }
        return category;
    };
    const parseAnd = () => {
        let worst = parsePrimary();
        while (tokens[position]?.toUpperCase() === 'AND') {
            position += 1;
            const next = parsePrimary();
            if (SEVERITY[next] > SEVERITY[worst])
                worst = next;
        }
        return worst;
    };
    function parseOr() {
        let best = parseAnd();
        while (tokens[position]?.toUpperCase() === 'OR') {
            position += 1;
            const next = parseAnd();
            if (SEVERITY[next] < SEVERITY[best])
                best = next;
        }
        return best;
    }
    return parseOr();
}
export function classifyLicense(license, options) {
    const categories = buildCategories(options.ruleset);
    if (license.expression !== null)
        return classifyExpression(license.expression, categories, options.overrides);
    const raw = license.raw;
    if (raw === null || raw.trim() === '')
        return 'unknown';
    const override = options.overrides[raw.toLowerCase()];
    if (override !== undefined)
        return override;
    if (ELASTIC_TEXT.test(raw))
        return 'case-by-case';
    if (NON_FREE_TEXT.test(raw))
        return 'non-free';
    return 'unknown';
}
const EXPLANATIONS = {
    permissive: 'Permissive license: usable anywhere, as long as the license and copyright notice are reproduced.',
    'weak-copyleft': 'Weak copyleft: usable, but if you distribute the software you must publish the source of this dependency and any changes to it. Check the specific terms of the license.',
    'strong-copyleft': 'Strong copyleft: if the software is distributed, all of your code linked to it must be released under the same license. Usable in purely internal projects only.',
    'network-copyleft': 'Network copyleft: the obligation triggers even when the software is only offered as a service, so it would cover a public web service. Not usable.',
    'non-free': 'Not an open source license: it restricts commercial use or is unlicensed, so the code may not be used.',
    'case-by-case': 'Source-available license with restrictions. Each use case needs approval from your legal team.',
    unknown: 'The license could not be determined. Code without a clear license may not be used; check the project and ask the author to publish one.',
};
function verdictFor(category, projectType) {
    switch (category) {
        case 'permissive':
        case 'weak-copyleft':
            return 'allowed';
        case 'strong-copyleft':
            return projectType === 'internal' ? 'allowed' : 'forbidden';
        case 'network-copyleft':
        case 'non-free':
            return 'forbidden';
        case 'case-by-case':
        case 'unknown':
            return 'review';
    }
}
function licenseLabel(license) {
    return license.expression ?? license.raw ?? 'unknown';
}
export function evaluatePolicy(packages, options) {
    const counts = {
        permissive: 0,
        'weak-copyleft': 0,
        'strong-copyleft': 0,
        'network-copyleft': 0,
        'non-free': 0,
        'case-by-case': 0,
        unknown: 0,
    };
    const exceptions = new Map(options.exceptions.map((entry) => [entry.package.toLowerCase(), entry.reason]));
    const findings = [];
    for (const pkg of packages) {
        const category = classifyLicense(pkg.license, options);
        counts[category] += 1;
        const verdict = verdictFor(category, options.projectType);
        if (verdict === 'allowed')
            continue;
        const accepted = exceptions.get(pkg.name.toLowerCase()) ?? null;
        findings.push({
            packageId: pkg.id,
            name: pkg.name,
            license: licenseLabel(pkg.license),
            category,
            verdict,
            explanation: EXPLANATIONS[category],
            acceptedReason: accepted,
            repositories: pkg.repositories,
        });
    }
    findings.sort((a, b) => SEVERITY[b.category] - SEVERITY[a.category] || a.name.localeCompare(b.name));
    const unaccepted = findings.filter((finding) => finding.acceptedReason === null);
    const blocking = options.failOn === 'none'
        ? []
        : options.failOn === 'forbidden'
            ? unaccepted.filter((finding) => finding.verdict === 'forbidden')
            : unaccepted;
    return {
        projectType: options.projectType,
        ruleset: options.ruleset,
        guidelinesUrl: options.guidelinesUrl,
        counts,
        findings,
        blocking,
    };
}
//# sourceMappingURL=policy.js.map