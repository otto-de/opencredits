// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

export interface TarSpec {
  path: string;
  content?: string | Buffer;
  type?: '0' | '5' | '2' | 'x';
  linkname?: string;
  /** Overrides the declared size for corruption tests. */
  declaredSize?: number;
}

function header(spec: TarSpec, size: number): Buffer {
  const block = Buffer.alloc(512, 0);
  block.write(spec.path.slice(0, 100), 0, 'utf8');
  block.write('0000644\0', 100, 'ascii');
  block.write('0000000\0', 108, 'ascii');
  block.write('0000000\0', 116, 'ascii');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  block.write('00000000000\0', 136, 'ascii');
  block.write('        ', 148, 'ascii');
  block.write(spec.type ?? '0', 156, 'ascii');
  if (spec.linkname !== undefined) block.write(spec.linkname, 157, 'utf8');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

export function buildTar(entries: TarSpec[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content ?? '', 'utf8');
    parts.push(header(entry, entry.declaredSize ?? body.length));
    parts.push(body);
    const padding = (512 - (body.length % 512)) % 512;
    parts.push(Buffer.alloc(padding, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

export function buildTarGz(entries: TarSpec[]): Buffer {
  return gzipSync(buildTar(entries));
}

export function paxRecord(key: string, value: string): string {
  const base = ` ${key}=${value}\n`;
  let length = base.length + 1;
  while (`${length}${base}`.length !== length) length = `${length}${base}`.length;
  return `${length}${base}`;
}

export type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;

export async function startServer(handler: Handler): Promise<{ url: string; close: () => Promise<void>; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push(`${req.method ?? 'GET'} ${url.pathname}${url.search}`);
    Promise.resolve(handler(req, res, url)).catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
