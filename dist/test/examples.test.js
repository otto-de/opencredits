// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/config.js';
import { loadCurations } from '../src/enrich/curations.js';
import { parseNpmLockfile } from '../src/extract/npm.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
function schemaKeys(node, prefix = '') {
    const keys = [];
    for (const variant of node.oneOf ?? [])
        keys.push(...schemaKeys(variant, prefix));
    for (const [key, child] of Object.entries(node.properties ?? {})) {
        keys.push(`${prefix}${key}`);
        keys.push(...schemaKeys(child, `${prefix}${key}.`));
    }
    return keys;
}
describe('examples and schema', () => {
    it('ships example configurations that pass validation', async () => {
        const org = await loadConfig(`${root}examples/github-organization/opencredits.config.json`);
        assert.equal(org.source.type, 'github');
        assert.equal(org.output.language, 'en');
        const single = await loadConfig(`${root}examples/single-repository/opencredits.config.json`);
        assert.equal(single.source.type, 'local');
        const demo = await loadConfig(`${root}examples/demo-shop/opencredits.config.json`);
        assert.equal(demo.output.language, 'de', 'the demo shows the German page');
        const curations = await loadCurations(org.enrichment.curationsFile ?? '');
        assert.equal(curations.additions[0]?.name, 'getopt');
    });
    it('ships a demo project with production and dev dependencies', async () => {
        const demo = await loadConfig(`${root}examples/demo-shop/opencredits.config.json`);
        assert.equal(demo.source.type, 'local');
        const lock = JSON.parse(readFileSync(`${root}examples/demo-shop/package-lock.json`, 'utf8'));
        const names = parseNpmLockfile(lock, false).map((pkg) => pkg.name);
        assert.deepEqual(names, ['clsx', 'date-fns', 'js-tokens', 'loose-envify', 'react', 'react-dom', 'scheduler', 'zod']);
    });
    it('ships example configurations for every way of running it', async () => {
        const names = ['single-repository', 'multi-repository', 'federated', 'github-organization', 'demo-shop'];
        const types = [];
        for (const name of names) {
            const config = await loadConfig(`${root}examples/${name}/opencredits.config.json`);
            types.push(config.source.type);
        }
        assert.deepEqual(types, ['local', 'repositories', 'local', 'github', 'local']);
    });
    it('documents every configuration key the parser reads', () => {
        const schema = JSON.parse(readFileSync(`${root}schema/opencredits.config.schema.json`, 'utf8'));
        const documented = new Set(schemaKeys(schema));
        const source = readFileSync(`${root}src/config/config.ts`, 'utf8');
        const read = [...source.matchAll(/v\.\w+\((\w+), '(\w+)', '([\w.]+)'/g)].map(([, , key, path]) => {
            const section = path === 'config' ? '' : `${path}.`;
            return `${section}${key}`;
        });
        assert.ok(read.length > 25, 'parser keys were found');
        for (const key of read)
            assert.ok(documented.has(key), `schema documents ${key}`);
    });
});
//# sourceMappingURL=examples.test.js.map