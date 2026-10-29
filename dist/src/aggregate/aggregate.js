// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
/** Compares versions numerically where possible; pre-releases sort before releases. */
export function compareVersions(a, b) {
    const [coreA = '', preA] = a.split('-', 2);
    const [coreB = '', preB] = b.split('-', 2);
    const partsA = coreA.split('.');
    const partsB = coreB.split('.');
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const x = partsA[i] ?? '0';
        const y = partsB[i] ?? '0';
        const nx = Number(x);
        const ny = Number(y);
        const diff = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
        if (diff !== 0)
            return diff;
    }
    if (preA === undefined && preB !== undefined)
        return 1;
    if (preA !== undefined && preB === undefined)
        return -1;
    return (preA ?? '').localeCompare(preB ?? '');
}
export function slugify(value) {
    const slug = value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug === '' ? 'package' : slug;
}
function licenseKey(pkg) {
    return pkg.license.expression ?? pkg.license.raw ?? 'UNKNOWN';
}
/**
 * Deduplicates packages across repositories and versions. A library is one
 * entry per (ecosystem, name, license): if a new version changed its license,
 * both appear, because the notices differ. Text and links come from the
 * newest version; copyright statements are merged across versions.
 */
export function aggregatePackages(packages) {
    const groups = new Map();
    for (const pkg of packages) {
        const key = `${pkg.ecosystem}\u0000${pkg.name.toLowerCase()}\u0000${licenseKey(pkg)}`;
        const group = groups.get(key) ?? [];
        group.push(pkg);
        groups.set(key, group);
    }
    const aggregated = [];
    for (const group of groups.values()) {
        group.sort((a, b) => compareVersions(b.version, a.version));
        const newest = group[0];
        const withText = group.find((pkg) => pkg.licenseText !== null);
        const withHomepage = group.find((pkg) => pkg.homepage !== null);
        const copyrights = [...new Set(group.flatMap((pkg) => pkg.copyrights))];
        const flags = new Set(group.flatMap((pkg) => pkg.flags));
        if (withText !== undefined)
            flags.delete('LICENSE_TEXT_MISSING');
        if (withHomepage !== undefined)
            flags.delete('HOMEPAGE_MISSING');
        if (copyrights.length > 0)
            flags.delete('COPYRIGHT_MISSING');
        aggregated.push({
            id: '',
            name: newest.name,
            ecosystem: newest.ecosystem,
            license: newest.license,
            licenseText: withText?.licenseText ?? null,
            noticeText: group.find((pkg) => pkg.noticeText !== null)?.noticeText ?? null,
            copyrights,
            homepage: withHomepage?.homepage ?? null,
            versions: [...new Set(group.map((pkg) => pkg.version))].sort(compareVersions),
            purls: [...new Set(group.map((pkg) => pkg.purl))].sort(),
            repositories: [...new Set(group.flatMap((pkg) => pkg.repositories))].sort(),
            flags: [...flags].sort(),
        });
    }
    aggregated.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
        a.ecosystem.localeCompare(b.ecosystem) ||
        licenseLabel(a).localeCompare(licenseLabel(b)));
    assignStableIds(aggregated);
    return aggregated;
}
export function licenseLabel(pkg) {
    return pkg.license.expression ?? pkg.license.raw ?? '';
}
/** Ids become URL anchors, so they must be stable between runs and unique. */
export function assignStableIds(packages) {
    const nameCounts = new Map();
    for (const pkg of packages)
        nameCounts.set(slugify(pkg.name), (nameCounts.get(slugify(pkg.name)) ?? 0) + 1);
    const used = new Set();
    for (const pkg of packages) {
        let id = slugify(pkg.name);
        if ((nameCounts.get(id) ?? 0) > 1)
            id = `${id}-${slugify(pkg.ecosystem)}-${slugify(licenseLabel(pkg) || 'unknown')}`;
        let candidate = id;
        for (let n = 2; used.has(candidate); n++)
            candidate = `${id}-${n}`;
        used.add(candidate);
        pkg.id = candidate;
    }
}
//# sourceMappingURL=aggregate.js.map