// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;
/**
 * Converts a small glob dialect to a RegExp.
 * Supported: "**" (any depth, including zero directories), "*" (within one path
 * segment) and "?" (one character). Matching is case-insensitive.
 */
export function globToRegExp(glob) {
    let pattern = '';
    for (let i = 0; i < glob.length; i++) {
        const char = glob.charAt(i);
        if (char === '*') {
            if (glob.charAt(i + 1) === '*') {
                if (glob.charAt(i + 2) === '/') {
                    pattern += '(?:.*/)?';
                    i += 2;
                }
                else {
                    pattern += '.*';
                    i += 1;
                }
            }
            else {
                pattern += '[^/]*';
            }
        }
        else if (char === '?') {
            pattern += '[^/]';
        }
        else {
            pattern += char.replace(REGEX_SPECIAL, '\\$&');
        }
    }
    return new RegExp(`^${pattern}$`, 'i');
}
export function matchesAny(path, patterns) {
    return patterns.some((pattern) => pattern.test(path));
}
//# sourceMappingURL=glob.js.map