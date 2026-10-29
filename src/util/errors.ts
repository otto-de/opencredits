// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

/** Raised for invalid user configuration. Maps to exit code 2. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

/** Raised when a safety limit (size, count, path) is violated. */
export class SafetyLimitError extends Error {
  override readonly name = 'SafetyLimitError';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
