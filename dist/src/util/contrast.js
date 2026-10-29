// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
function channel(value) {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}
/** Relative luminance of a #RRGGBB color as defined by WCAG 2.1. */
export function relativeLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(foreground, background) {
    const a = relativeLuminance(foreground);
    const b = relativeLuminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** Page backgrounds used by the renderer; accent colors are validated against them. */
export const LIGHT_BACKGROUND = '#FFFFFF';
export const DARK_BACKGROUND = '#16191D';
export const MIN_TEXT_CONTRAST = 4.5;
//# sourceMappingURL=contrast.js.map