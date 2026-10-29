// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
const secrets = new Set();
const TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
/** Registers a secret value so it is masked in every log line. */
export function registerSecret(value) {
    if (value !== undefined && value.length >= 8)
        secrets.add(value);
}
export function redact(text) {
    let out = text.replace(TOKEN_PATTERN, '***');
    for (const secret of secrets)
        out = out.split(secret).join('***');
    return out;
}
function threshold() {
    const configured = process.env.OPENCREDITS_LOG_LEVEL;
    if (configured === 'debug' || configured === 'info' || configured === 'warn' || configured === 'error') {
        return ORDER[configured];
    }
    return ORDER.info;
}
function write(level, msg, fields = {}) {
    if (ORDER[level] < threshold())
        return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
    process.stderr.write(`${redact(line)}\n`);
}
export const log = {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
};
//# sourceMappingURL=log.js.map