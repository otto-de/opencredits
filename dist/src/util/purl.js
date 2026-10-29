// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
/** Parses a purl string. Returns null when the input is not a valid purl. */
export function parsePurl(input) {
    if (!input.startsWith('pkg:'))
        return null;
    let rest = input.slice(4);
    const hash = rest.indexOf('#');
    if (hash >= 0)
        rest = rest.slice(0, hash);
    const question = rest.indexOf('?');
    if (question >= 0)
        rest = rest.slice(0, question);
    let version = null;
    const at = rest.lastIndexOf('@');
    const lastSlash = rest.lastIndexOf('/');
    if (at > lastSlash) {
        version = safeDecode(rest.slice(at + 1));
        rest = rest.slice(0, at);
    }
    const segments = rest.split('/').filter((segment) => segment.length > 0);
    const type = segments.shift()?.toLowerCase();
    const name = segments.pop();
    if (type === undefined || name === undefined || !/^[a-z][a-z0-9.+-]*$/.test(type))
        return null;
    const namespace = segments.length > 0 ? segments.map(safeDecode).join('/') : null;
    return { type, namespace, name: safeDecode(name), version };
}
function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
/** Human-readable package name, following each ecosystem's conventions. */
export function displayName(purl) {
    if (purl.namespace === null)
        return purl.name;
    if (purl.type === 'maven')
        return `${purl.namespace}:${purl.name}`;
    return `${purl.namespace}/${purl.name}`;
}
export function npmPurl(name, version) {
    const [scope, bare] = name.startsWith('@') ? name.split('/', 2) : [undefined, name];
    const namespace = scope !== undefined ? `${encodeURIComponent(scope)}/` : '';
    return `pkg:npm/${namespace}${encodeURIComponent(bare ?? name)}@${encodeURIComponent(version)}`;
}
//# sourceMappingURL=purl.js.map