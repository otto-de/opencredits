// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { extractTarGz, readFilesFromTarGz, sanitizeEntryPath } from '../src/fetch/tar.js';
import { isManifestPath } from '../src/extract/types.js';
import { buildTar, buildTarGz, paxRecord } from './helpers.js';
import { gzipSync } from 'node:zlib';

const LIMITS = { maxEntryBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024, maxEntries: 1000, maxStreamBytes: 50 * 1024 * 1024 };

describe('sanitizeEntryPath', () => {
  it('rejects traversal, absolute and backslash paths', () => {
    assert.equal(sanitizeEntryPath('../etc/passwd', 0), null);
    assert.equal(sanitizeEntryPath('repo/../../etc', 1), null);
    assert.equal(sanitizeEntryPath('/etc/passwd', 0), null);
    assert.equal(sanitizeEntryPath('C:/windows', 0), null);
    assert.equal(sanitizeEntryPath('repo\\evil', 0), null);
  });

  it('strips leading components', () => {
    assert.equal(sanitizeEntryPath('org-repo-abc123/src/package.json', 1), 'src/package.json');
    assert.equal(sanitizeEntryPath('org-repo-abc123/', 1), null);
  });
});

describe('extractTarGz', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'opencredits-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts regular files and strips the archive prefix', async () => {
    const archive = buildTarGz([
      { path: 'prefix/', type: '5' },
      { path: 'prefix/package-lock.json', content: '{"lockfileVersion":3}' },
      { path: 'prefix/web/package.json', content: '{}' },
    ]);
    const result = await extractTarGz(Readable.from([archive]), dir, { ...LIMITS, stripComponents: 1 });
    assert.equal(result.files, 2);
    assert.equal(await readFile(join(dir, 'package-lock.json'), 'utf8'), '{"lockfileVersion":3}');
    assert.equal(await readFile(join(dir, 'web/package.json'), 'utf8'), '{}');
  });

  it('never creates symlinks and never writes outside the destination', async () => {
    const archive = buildTarGz([
      { path: 'prefix/link', type: '2', linkname: '/etc/passwd' },
      { path: 'prefix/../../escape.txt', content: 'nope' },
      { path: 'prefix/ok.txt', content: 'fine' },
    ]);
    const result = await extractTarGz(Readable.from([archive]), dir, { ...LIMITS, stripComponents: 1 });
    assert.equal(existsSync(join(dir, 'link')), false);
    assert.equal(existsSync(join(dir, '..', 'escape.txt')), false);
    assert.equal(result.files, 1);
    assert.ok(result.skipped.some((item) => item.reason === 'unsafe path'));
    assert.ok(result.skipped.some((item) => item.reason.startsWith('unsupported entry type')));
  });

  it('honours PAX long paths', async () => {
    const longName = `prefix/${'deep/'.repeat(30)}package-lock.json`;
    const archive = buildTarGz([
      { path: 'PaxHeader', type: 'x', content: paxRecord('path', longName) },
      { path: 'truncated-name', content: '{}' },
    ]);
    await extractTarGz(Readable.from([archive]), dir, { ...LIMITS, stripComponents: 1 });
    assert.equal(existsSync(join(dir, `${'deep/'.repeat(30)}package-lock.json`)), true);
  });

  it('only extracts manifests in manifests mode', async () => {
    const archive = buildTarGz([
      { path: 'prefix/src/index.ts', content: 'export {}' },
      { path: 'prefix/go.mod', content: 'module x' },
      { path: 'prefix/node_modules/a/package.json', content: '{}' },
    ]);
    const result = await extractTarGz(Readable.from([archive]), dir, { ...LIMITS, stripComponents: 1, filter: isManifestPath });
    assert.equal(result.files, 1);
    assert.equal(existsSync(join(dir, 'go.mod')), true);
    assert.equal(existsSync(join(dir, 'src/index.ts')), false);
  });

  it('enforces the total size limit', async () => {
    const archive = buildTarGz([{ path: 'prefix/big.json', content: 'x'.repeat(5000) }]);
    await assert.rejects(
      extractTarGz(Readable.from([archive]), dir, { ...LIMITS, maxTotalBytes: 1000, stripComponents: 1 }),
      /exceeds 1000 bytes/,
    );
  });

  it('enforces the decompressed stream limit', async () => {
    const archive = buildTarGz([{ path: 'prefix/zeros.bin', content: Buffer.alloc(200_000) }]);
    await assert.rejects(
      extractTarGz(Readable.from([archive]), dir, { ...LIMITS, maxStreamBytes: 10_000, stripComponents: 1 }),
      /Archive exceeds/,
    );
  });

  it('rejects headers with a bad checksum', async () => {
    const tar = buildTar([{ path: 'prefix/a.json', content: '{}' }]);
    tar[0] = 'Z'.charCodeAt(0);
    await assert.rejects(extractTarGz(Readable.from([gzipSync(tar)]), dir, { ...LIMITS, stripComponents: 1 }), /checksum/);
  });

  it('rejects truncated archives', async () => {
    const tar = buildTar([{ path: 'prefix/a.json', content: 'x'.repeat(2000) }]);
    await assert.rejects(
      extractTarGz(Readable.from([gzipSync(tar.subarray(0, 1024))]), dir, { ...LIMITS, stripComponents: 1 }),
      /Truncated/,
    );
  });
});

describe('readFilesFromTarGz', () => {
  it('returns only selected top-level files', async () => {
    const archive = buildTarGz([
      { path: 'package/LICENSE', content: 'MIT License' },
      { path: 'package/lib/LICENSE', content: 'nested' },
      { path: 'package/index.js', content: 'code' },
    ]);
    const files = await readFilesFromTarGz(archive, (path) => !path.includes('/') && path.startsWith('LICENSE'), LIMITS, 1);
    assert.deepEqual([...files.keys()], ['LICENSE']);
    assert.equal(files.get('LICENSE')?.toString('utf8'), 'MIT License');
  });
});
