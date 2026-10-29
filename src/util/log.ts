// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const secrets = new Set<string>();
const TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

/** Registers a secret value so it is masked in every log line. */
export function registerSecret(value: string | undefined): void {
  if (value !== undefined && value.length >= 8) secrets.add(value);
}

export function redact(text: string): string {
  let out = text.replace(TOKEN_PATTERN, '***');
  for (const secret of secrets) out = out.split(secret).join('***');
  return out;
}

function threshold(): number {
  const configured = process.env.OPENCREDITS_LOG_LEVEL;
  if (configured === 'debug' || configured === 'info' || configured === 'warn' || configured === 'error') {
    return ORDER[configured];
  }
  return ORDER.info;
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  process.stderr.write(`${redact(line)}\n`);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
