// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import { mkdir, open } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { SafetyLimitError } from '../util/errors.js';
const BLOCK = 512;
function readString(block, offset, length) {
    const slice = block.subarray(offset, offset + length);
    const end = slice.indexOf(0);
    return slice.subarray(0, end >= 0 ? end : slice.length).toString('utf8');
}
function readOctal(block, offset, length) {
    const first = block[offset] ?? 0;
    if ((first & 0x80) !== 0) {
        throw new SafetyLimitError('Tar entry uses base-256 size encoding, which is not supported');
    }
    const text = readString(block, offset, length).trim();
    if (text === '')
        return 0;
    if (!/^[0-7]+$/.test(text))
        throw new SafetyLimitError('Corrupt tar header: invalid octal field');
    return parseInt(text, 8);
}
function verifyChecksum(block) {
    const expected = readOctal(block, 148, 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++)
        sum += i >= 148 && i < 156 ? 0x20 : block[i];
    if (sum !== expected)
        throw new SafetyLimitError('Corrupt tar header: checksum mismatch');
}
function parsePax(body) {
    const records = new Map();
    let offset = 0;
    while (offset < body.length) {
        const space = body.indexOf(0x20, offset);
        if (space < 0)
            break;
        const length = Number(body.subarray(offset, space).toString('utf8'));
        if (!Number.isInteger(length) || length <= 0 || offset + length > body.length)
            break;
        const record = body.subarray(space + 1, offset + length - 1).toString('utf8');
        const equals = record.indexOf('=');
        if (equals > 0)
            records.set(record.slice(0, equals), record.slice(equals + 1));
        offset += length;
    }
    return records;
}
/** Returns a normalised relative path, or null if the path is unsafe. */
export function sanitizeEntryPath(rawPath, stripComponents) {
    if (rawPath.includes('\0') || rawPath.includes('\\'))
        return null;
    if (isAbsolute(rawPath) || /^[A-Za-z]:/.test(rawPath))
        return null;
    const segments = rawPath.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.some((segment) => segment === '..'))
        return null;
    const stripped = segments.slice(stripComponents);
    return stripped.length === 0 ? null : stripped.join('/');
}
export async function walkTar(source, visitor, limits, stripComponents = 0) {
    const iterator = source[Symbol.asyncIterator]();
    let buffer = Buffer.alloc(0);
    let ended = false;
    let streamBytes = 0;
    let entries = 0;
    let totalBytes = 0;
    const skipped = [];
    async function fill(size) {
        while (buffer.length < size && !ended) {
            const next = await iterator.next();
            if (next.done === true) {
                ended = true;
                break;
            }
            const chunk = Buffer.from(next.value);
            streamBytes += chunk.length;
            if (streamBytes > limits.maxStreamBytes)
                throw new SafetyLimitError(`Archive exceeds ${limits.maxStreamBytes} bytes`);
            buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
        }
        return buffer.length >= size;
    }
    function take(size) {
        const out = buffer.subarray(0, size);
        buffer = buffer.subarray(size);
        return out;
    }
    async function consume(size, sink) {
        let remaining = size;
        while (remaining > 0) {
            if (buffer.length === 0 && !(await fill(1)))
                throw new SafetyLimitError('Truncated tar archive');
            const part = take(Math.min(remaining, buffer.length));
            remaining -= part.length;
            if (sink !== undefined)
                await sink(part);
        }
    }
    async function readBody(size, max) {
        if (size > max)
            throw new SafetyLimitError('Tar metadata entry too large');
        const parts = [];
        await consume(size, (chunk) => {
            parts.push(Buffer.from(chunk));
        });
        await consume((BLOCK - (size % BLOCK)) % BLOCK);
        return Buffer.concat(parts);
    }
    let pendingPath = null;
    let pendingSize = null;
    try {
        for (;;) {
            if (!(await fill(BLOCK)))
                break;
            const header = take(BLOCK);
            if (header.every((byte) => byte === 0))
                break;
            verifyChecksum(header);
            const typeFlag = String.fromCharCode(header[156] ?? 0);
            let size = readOctal(header, 124, 12);
            if (typeFlag === 'x') {
                const pax = parsePax(await readBody(size, 1024 * 1024));
                pendingPath = pax.get('path') ?? pendingPath;
                const paxSize = pax.get('size');
                if (paxSize !== undefined && /^\d+$/.test(paxSize))
                    pendingSize = Number(paxSize);
                continue;
            }
            if (typeFlag === 'g') {
                await readBody(size, 1024 * 1024);
                continue;
            }
            if (typeFlag === 'L') {
                pendingPath = (await readBody(size, 64 * 1024)).toString('utf8').replace(/\0+$/, '');
                continue;
            }
            const prefix = readString(header, 345, 155);
            const name = readString(header, 0, 100);
            const rawPath = pendingPath ?? (prefix !== '' ? `${prefix}/${name}` : name);
            if (pendingSize !== null)
                size = pendingSize;
            pendingPath = null;
            pendingSize = null;
            entries += 1;
            if (entries > limits.maxEntries)
                throw new SafetyLimitError(`Archive has more than ${limits.maxEntries} entries`);
            const padding = (BLOCK - (size % BLOCK)) % BLOCK;
            const path = sanitizeEntryPath(rawPath, stripComponents);
            const type = typeFlag === '0' || typeFlag === '\0' || typeFlag === '7' ? 'file' : typeFlag === '5' ? 'directory' : 'other';
            if (path === null) {
                if (sanitizeEntryPath(rawPath, 0) === null)
                    skipped.push({ path: rawPath, reason: 'unsafe path' });
                await consume(size + padding);
                continue;
            }
            if (type === 'other') {
                skipped.push({ path, reason: `unsupported entry type ${JSON.stringify(typeFlag)}` });
                await consume(size + padding);
                continue;
            }
            const entry = { path, size, type };
            let wanted = await visitor.onEntry(entry);
            if (wanted && type === 'file' && size > limits.maxEntryBytes) {
                skipped.push({ path, reason: `larger than ${limits.maxEntryBytes} bytes` });
                wanted = false;
            }
            if (wanted && type === 'file') {
                totalBytes += size;
                if (totalBytes > limits.maxTotalBytes)
                    throw new SafetyLimitError(`Extracted content exceeds ${limits.maxTotalBytes} bytes`);
                await consume(size, (chunk) => visitor.onChunk?.(entry, chunk));
                await visitor.onEntryEnd?.(entry);
                await consume(padding);
            }
            else {
                await consume(size + padding);
            }
        }
    }
    finally {
        await iterator.return?.();
    }
    return { entries, bytes: totalBytes, skipped };
}
/** Extracts regular files and directories from a gzip-compressed tar stream into destDir. */
export async function extractTarGz(compressed, destDir, options) {
    const root = resolve(destDir);
    let files = 0;
    // Held in an object so the finally block sees updates made inside callbacks.
    const state = { current: null };
    const gunzip = compressed.pipe(createGunzip());
    compressed.on('error', (error) => gunzip.destroy(error));
    const targetFor = (entryPath) => {
        const target = resolve(root, entryPath);
        const rel = relative(root, target);
        if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || !target.startsWith(root + sep)) {
            throw new SafetyLimitError(`Entry escapes destination: ${entryPath}`);
        }
        return target;
    };
    try {
        const result = await walkTar(gunzip, {
            async onEntry(entry) {
                if (options.filter !== undefined && entry.type === 'file' && !options.filter(entry.path))
                    return false;
                const target = targetFor(entry.path);
                if (entry.type === 'directory') {
                    if (options.filter === undefined)
                        await mkdir(target, { recursive: true, mode: 0o755 });
                    return false;
                }
                await mkdir(join(target, '..'), { recursive: true, mode: 0o755 });
                state.current = { handle: await open(target, 'w', 0o644), path: entry.path };
                files += 1;
                return true;
            },
            async onChunk(_entry, chunk) {
                if (state.current !== null)
                    await state.current.handle.write(chunk);
            },
            async onEntryEnd() {
                if (state.current !== null) {
                    await state.current.handle.close();
                    state.current = null;
                }
            },
        }, options, options.stripComponents);
        return { files, bytes: result.bytes, skipped: result.skipped };
    }
    finally {
        if (state.current !== null)
            await state.current.handle.close().catch(() => undefined);
    }
}
/** Reads selected small files from a gzip-compressed tar held in memory. */
export async function readFilesFromTarGz(data, select, limits, stripComponents) {
    const files = new Map();
    const parts = new Map();
    await walkTar(Readable.from([data]).pipe(createGunzip()), {
        onEntry: (entry) => entry.type === 'file' && select(entry.path),
        onChunk: (entry, chunk) => {
            const list = parts.get(entry.path) ?? [];
            list.push(Buffer.from(chunk));
            parts.set(entry.path, list);
        },
        onEntryEnd: (entry) => {
            files.set(entry.path, Buffer.concat(parts.get(entry.path) ?? []));
            parts.delete(entry.path);
        },
    }, limits, stripComponents);
    return files;
}
//# sourceMappingURL=tar.js.map