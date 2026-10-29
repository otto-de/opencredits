// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
/** Raised for invalid user configuration. Maps to exit code 2. */
export class ConfigError extends Error {
    problems;
    name = 'ConfigError';
    constructor(problems) {
        super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
        this.problems = problems;
    }
}
/** Raised when a safety limit (size, count, path) is violated. */
export class SafetyLimitError extends Error {
    name = 'SafetyLimitError';
}
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=errors.js.map