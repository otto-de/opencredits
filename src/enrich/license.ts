// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import type { Flag, LicenseInfo } from '../model.js';

/**
 * Commonly used SPDX license identifiers (https://spdx.org/licenses/).
 * Identifiers not listed here are still accepted when they look like SPDX IDs,
 * but are flagged for review so a human can confirm them.
 */
const KNOWN_IDS = [
  '0BSD', 'AFL-2.1', 'AFL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'Apache-1.1', 'Apache-2.0', 'APSL-2.0',
  'Artistic-1.0', 'Artistic-2.0', 'BlueOak-1.0.0', 'BSD-1-Clause', 'BSD-2-Clause', 'BSD-2-Clause-Patent',
  'BSD-3-Clause', 'BSD-3-Clause-Clear', 'BSD-4-Clause', 'bzip2-1.0.6', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-3.0',
  'CC-BY-SA-4.0', 'CC0-1.0', 'CDDL-1.0', 'CDDL-1.1', 'CPL-1.0', 'curl', 'ECL-2.0', 'EPL-1.0', 'EPL-2.0',
  'EUPL-1.1', 'EUPL-1.2', 'FTL', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'Hippocratic-2.1', 'ICU', 'IJG', 'ISC', 'JSON', 'LGPL-2.0-only', 'LGPL-2.0-or-later', 'LGPL-2.1-only',
  'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'libpng-2.0', 'MIT', 'MIT-0', 'MIT-CMU',
  'MPL-1.1', 'MPL-2.0', 'MPL-2.0-no-copyleft-exception', 'MS-PL', 'MS-RL', 'MulanPSL-2.0', 'NCSA', 'ODbL-1.0',
  'OFL-1.0', 'OFL-1.1', 'OpenSSL', 'PHP-3.01', 'PostgreSQL', 'PSF-2.0', 'Python-2.0', 'Ruby', 'SSPL-1.0',
  'Unicode-3.0', 'Unicode-DFS-2016', 'Unlicense', 'UPL-1.0', 'Vim', 'W3C', 'WTFPL', 'X11', 'Zlib', 'ZPL-2.1',
];
const KNOWN_EXCEPTIONS = ['Classpath-exception-2.0', 'LLVM-exception', 'GCC-exception-3.1', 'Autoconf-exception-3.0'];

const CANONICAL = new Map([...KNOWN_IDS, ...KNOWN_EXCEPTIONS].map((id) => [id.toLowerCase(), id]));

/** Deprecated or informal names mapped to current SPDX identifiers. */
const ALIASES = new Map<string, string>([
  ['apache 2.0', 'Apache-2.0'],
  ['apache 2', 'Apache-2.0'],
  ['apache-2', 'Apache-2.0'],
  ['apache2', 'Apache-2.0'],
  ['apache license 2.0', 'Apache-2.0'],
  ['apache license, version 2.0', 'Apache-2.0'],
  ['apache software license', 'Apache-2.0'],
  ['the apache software license, version 2.0', 'Apache-2.0'],
  ['mit license', 'MIT'],
  ['the mit license', 'MIT'],
  ['isc license', 'ISC'],
  ['bsd-2', 'BSD-2-Clause'],
  ['simplified bsd', 'BSD-2-Clause'],
  ['bsd-3', 'BSD-3-Clause'],
  ['new bsd', 'BSD-3-Clause'],
  ['bsd 3-clause', 'BSD-3-Clause'],
  ['new bsd license', 'BSD-3-Clause'],
  ['gpl-2.0', 'GPL-2.0-only'],
  ['gpl-2.0+', 'GPL-2.0-or-later'],
  ['gplv2', 'GPL-2.0-only'],
  ['gpl-3.0', 'GPL-3.0-only'],
  ['gpl-3.0+', 'GPL-3.0-or-later'],
  ['gplv3', 'GPL-3.0-only'],
  ['lgpl-2.1', 'LGPL-2.1-only'],
  ['lgpl-2.1+', 'LGPL-2.1-or-later'],
  ['lgpl-3.0', 'LGPL-3.0-only'],
  ['lgpl-3.0+', 'LGPL-3.0-or-later'],
  ['agpl-3.0', 'AGPL-3.0-only'],
  ['mpl 2.0', 'MPL-2.0'],
  ['mozilla public license 2.0', 'MPL-2.0'],
  ['eclipse public license 2.0', 'EPL-2.0'],
  ['cc0', 'CC0-1.0'],
  ['the unlicense', 'Unlicense'],
  ['python software foundation license', 'PSF-2.0'],
]);

const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9.-]*\+?$/;

export interface NormalizedLicense extends LicenseInfo {
  flags: Flag[];
}

function tokenize(expression: string): string[] | null {
  const tokens = expression.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/);
  return tokens.length > 0 && tokens[0] !== '' ? tokens : null;
}

/**
 * Normalises a declared license into an SPDX expression.
 * Returns expression=null when the value cannot be expressed in SPDX terms.
 */
export function normalizeLicenseExpression(input: string): NormalizedLicense {
  const raw = input.trim();
  if (raw === '' || raw === 'UNLICENSED' || raw === 'NOASSERTION' || raw === 'NONE') {
    return { expression: null, raw: raw === '' ? null : raw, flags: ['LICENSE_UNKNOWN'] };
  }

  const alias = ALIASES.get(raw.toLowerCase());
  if (alias !== undefined) return { expression: alias, raw, flags: [] };

  const tokens = tokenize(raw);
  if (tokens === null) return { expression: null, raw, flags: ['LICENSE_UNKNOWN'] };

  const flags = new Set<Flag>();
  const out: string[] = [];
  let expectOperand = true;
  let depth = 0;
  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (token === '(') {
      if (!expectOperand) return nonSpdx(raw);
      depth += 1;
      out.push(token);
    } else if (token === ')') {
      if (expectOperand || depth === 0) return nonSpdx(raw);
      depth -= 1;
      out.push(token);
    } else if (upper === 'AND' || upper === 'OR' || upper === 'WITH') {
      if (expectOperand) return nonSpdx(raw);
      out.push(upper);
      expectOperand = true;
    } else {
      if (!expectOperand) return nonSpdx(raw);
      if (/^(?:LicenseRef|DocumentRef)-[A-Za-z0-9.-]+(?::LicenseRef-[A-Za-z0-9.-]+)?$/.test(token)) {
        out.push(token);
        flags.add('LICENSE_NON_SPDX');
      } else {
        const plus = token.endsWith('+');
        const base = plus ? token.slice(0, -1) : token;
        const tokenAlias = ALIASES.get(token.toLowerCase());
        const canonical = CANONICAL.get(base.toLowerCase());
        if (tokenAlias !== undefined) {
          out.push(tokenAlias);
        } else if (canonical !== undefined) {
          out.push(plus ? `${canonical}+` : canonical);
        } else if (ID_SHAPE.test(token)) {
          out.push(token);
          flags.add('LICENSE_NON_SPDX');
        } else {
          return nonSpdx(raw);
        }
      }
      expectOperand = false;
    }
  }
  if (expectOperand || depth !== 0) return nonSpdx(raw);
  const expression = out.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');
  return { expression, raw, flags: [...flags] };
}

function nonSpdx(raw: string): NormalizedLicense {
  return { expression: null, raw, flags: ['LICENSE_NON_SPDX'] };
}

/** Accepts npm's historical formats: string, {type}, or an array of either. */
export function normalizeDeclaredLicense(value: unknown): NormalizedLicense {
  if (typeof value === 'string') return normalizeLicenseExpression(value);
  const items = Array.isArray(value) ? value : value !== undefined && value !== null ? [value] : [];
  const names = items
    .map((item) => (typeof item === 'string' ? item : typeof item === 'object' && item !== null ? (item as { type?: unknown }).type : undefined))
    .filter((name): name is string => typeof name === 'string' && name.trim() !== '');
  if (names.length === 0) return { expression: null, raw: null, flags: ['LICENSE_UNKNOWN'] };
  // Multiple entries in the legacy "licenses" array meant a choice between licenses.
  return normalizeLicenseExpression(names.length === 1 ? (names[0] as string) : names.map((n) => `(${n})`).join(' OR '));
}

/** A single SPDX identifier suitable for linking to spdx.org, or null for compound expressions. */
export function singleSpdxId(expression: string | null): string | null {
  if (expression === null || !/^[A-Za-z0-9.-]+\+?$/.test(expression)) return null;
  return CANONICAL.has(expression.replace(/\+$/, '').toLowerCase()) ? expression.replace(/\+$/, '') : null;
}

const LICENSE_FILE = /^(?:licen[cs]e|copying|unlicense)(?:[.-][^/]*)?$/i;
const NOTICE_FILE = /^notice(?:\.[^/]*)?$/i;

export function isLicenseFileName(name: string): boolean {
  return LICENSE_FILE.test(name);
}

export function isNoticeFileName(name: string): boolean {
  return NOTICE_FILE.test(name);
}

/** Orders license file candidates so the most canonical file wins. */
export function rankLicenseFile(name: string): number {
  const lower = name.toLowerCase();
  const order = ['license', 'license.md', 'license.txt', 'licence', 'licence.md', 'licence.txt', 'copying'];
  const index = order.indexOf(lower);
  return index >= 0 ? index : order.length + lower.length;
}

const EMAIL = /<?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}>?/g;
const COPYRIGHT_LINE = /^(?:copyright\b|\(c\)\s|©)/i;
const TEMPLATE_HINTS = [
  /copyright\s+notice/i,
  /copyright\s+holders?\b/i,
  /copyright\s+owner/i,
  /\[yyyy\]|\[year\]|<year>|\{yyyy\}/i,
  /copyright\s+and\s+(?:related|license)/i,
  /copyright\s+law/i,
  /copyright\s+statement/i,
  /the\s+above\s+copyright/i,
  /^copyright\s*$/i,
];

export function stripEmails(text: string): string {
  return text.replace(EMAIL, '').replace(/\s{2,}/g, ' ').replace(/[\s,]+$/, '').trim();
}

/** Extracts copyright statements from license or notice text. */
export function extractCopyrights(text: string, options: { stripEmails: boolean }): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s*#/;!-]+/, '').replace(/\s+/g, ' ').trim();
    if (!COPYRIGHT_LINE.test(line) || line.length > 300) continue;
    if (TEMPLATE_HINTS.some((hint) => hint.test(line))) continue;
    if (!/\d{4}|\(c\)|©/i.test(line) && line.split(' ').length < 3) continue;
    const cleaned = options.stripEmails ? stripEmails(line) : line;
    const key = cleaned.toLowerCase();
    if (cleaned.length > 0 && !seen.has(key)) {
      seen.add(key);
      results.push(cleaned);
    }
    if (results.length >= 20) break;
  }
  return results;
}

/** Normalises line endings and trims trailing whitespace of license texts. */
export function normalizeText(text: string, maxLength = 256 * 1024): string {
  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}\n[…]` : normalized;
}
