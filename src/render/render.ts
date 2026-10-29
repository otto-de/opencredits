// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OutputConfig } from '../config/config.js';
import { singleSpdxId } from '../enrich/license.js';
import type { AggregatedPackage, Dataset } from '../model.js';
import { DARK_BACKGROUND, LIGHT_BACKGROUND } from '../util/contrast.js';
import { MESSAGES, type Messages } from './i18n.js';
import { html, SafeHtml, safeHref } from './template.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Styles are inlined and allowed by hash in the Content Security Policy. */
export function buildStyles(accent: string, accentDark: string): string {
  if (!HEX_COLOR.test(accent) || !HEX_COLOR.test(accentDark)) throw new Error('Accent colors must be #RRGGBB values');
  return `
:root{--paper:${LIGHT_BACKGROUND};--ink:#1E2226;--muted:#565D66;--rule:#DCE0E5;--sunk:#F3F5F7;--accent:${accent};color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:${DARK_BACKGROUND};--ink:#E8EAED;--muted:#A9B0B8;--rule:#343A41;--sunk:#1F2328;--accent:${accentDark}}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:1rem/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
a{color:var(--accent);text-underline-offset:.15em}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.skip{position:absolute;left:1rem;top:-10rem;padding:.75rem 1rem;background:var(--paper);border:2px solid var(--accent)}
.skip:focus{top:1rem}
.page{max-width:46rem;margin:0 auto;padding:2rem 1.25rem 3rem}
h1{font-size:clamp(1.75rem,6vw,2.5rem);line-height:1.15;letter-spacing:-.015em;margin:0 0 .75rem}
.intro{margin:0 0 1rem;max-width:38rem}
.meta{margin:0;color:var(--muted);font-size:.9375rem}
.index{margin:2rem 0 0;padding:.25rem 0;border-block:1px solid var(--rule)}
.index ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap}
.index a{display:flex;align-items:center;justify-content:center;min-width:2.75rem;min-height:2.75rem;padding:0 .5rem;font-weight:600;text-decoration:none}
.index a:hover{background:var(--sunk)}
.letter{margin-top:2.5rem}
.letter>h2{font-size:1.5rem;line-height:1.2;margin:0;padding-bottom:.375rem;border-bottom:2px solid var(--ink)}
.entries{list-style:none;margin:0;padding:0}
.entry{padding:1.25rem 0;border-bottom:1px solid var(--rule)}
.entry h3{font-size:1.125rem;line-height:1.35;margin:0 0 .5rem;overflow-wrap:anywhere}
.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.25rem 1rem;margin:0}
.facts dt{color:var(--muted);font-size:.875rem;line-height:1.75}
.facts dd{margin:0;overflow-wrap:anywhere}
.facts ul{list-style:none;margin:0;padding:0}
.license{font-weight:600}
details{margin-top:.5rem}
summary{cursor:pointer;padding:.625rem 0;color:var(--accent);font-weight:600;width:fit-content}
h4{font-size:.875rem;margin:1rem 0 0;color:var(--muted)}
pre{margin:.25rem 0 0;padding:1rem;background:var(--sunk);font:.8125rem/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.back{display:inline-block;margin-top:.75rem;padding:.625rem 0;font-size:.9375rem}
.empty{margin-top:2.5rem;padding:1.5rem;background:var(--sunk)}
footer{margin-top:3rem;color:var(--muted);font-size:.875rem}
.visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
@media (min-width:60rem){.page{max-width:54rem}.letter{display:grid;grid-template-columns:5rem minmax(0,1fr);column-gap:2rem}.letter>h2{grid-row:1/span 2;position:sticky;top:1rem;align-self:start;font-size:3rem;line-height:1;border:0;padding-top:1rem}.letter>.entries,.letter>.back{grid-column:2}}
@media (forced-colors:active){summary,a{color:LinkText}pre{border:1px solid CanvasText}}
@media print{.index,.back,.skip,summary{display:none}details>*{display:block}}
`.trim();
}

function groupKey(name: string): string {
  const first = name
    .replace(/^@/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .charAt(0)
    .toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
}

function groupId(key: string): string {
  return key === '#' ? 'letter-other' : `letter-${key.toLowerCase()}`;
}

function renderEntry(pkg: AggregatedPackage, output: OutputConfig, t: Messages): SafeHtml {
  const nameId = `${pkg.id}-name`;
  const licenseLabel = pkg.license.expression ?? pkg.license.raw ?? t.notSpecified;
  const homepage = safeHref(pkg.homepage);
  const spdxId = singleSpdxId(pkg.license.expression);

  const copyrights =
    pkg.copyrights.length > 0
      ? html`<dt>${t.copyrightLabel}</dt><dd><ul>${pkg.copyrights.map((line) => html`<li>${line}</li>`)}</ul></dd>`
      : '';

  const source =
    homepage !== null
      ? html`<dt>${t.sourceLabel}</dt><dd><a href="${homepage}" rel="noopener nofollow">${homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></dd>`
      : '';

  const versions = output.showVersions ? html`<dt>${t.versionsLabel}</dt><dd>${pkg.versions.join(', ')}</dd>` : '';

  let body: SafeHtml;
  if (pkg.licenseText !== null) {
    body = html`<details><summary>${t.showLicenseText}<span class="visually-hidden">: ${pkg.name}</span></summary><pre>${pkg.licenseText}</pre>${
      pkg.noticeText !== null ? html`<h4>${t.noticeHeading}</h4><pre>${pkg.noticeText}</pre>` : ''
    }</details>`;
  } else if (spdxId !== null) {
    const url = `https://spdx.org/licenses/${encodeURIComponent(spdxId)}.html`;
    body = html`<p>${t.licenseTextAt} <a href="${url}" rel="noopener">spdx.org/licenses/${spdxId}</a></p>`;
  } else {
    body = html`<p>${t.noLicenseText}</p>`;
  }

  return html`<li class="entry" id="${pkg.id}"><article aria-labelledby="${nameId}"><h3 id="${nameId}">${pkg.name}</h3><dl class="facts"><dt>${t.licenseLabel}</dt><dd class="license">${licenseLabel}</dd>${copyrights}${source}${versions}</dl>${body}</article></li>`;
}

export interface RenderedSite {
  html: string;
  styleHash: string;
}

export function renderPage(dataset: Dataset, output: OutputConfig): RenderedSite {
  const t = MESSAGES[output.language];
  const title = output.title !== '' ? output.title : t.defaultTitle;
  const intro = output.intro ?? t.defaultIntro;
  const styles = buildStyles(output.accentColor, output.accentColorDark);
  const styleHash = createHash('sha256').update(styles, 'utf8').digest('base64');
  const generated = new Date(dataset.generatedAt);
  const dateLabel = new Intl.DateTimeFormat(output.language, { dateStyle: 'long', timeZone: 'UTC' }).format(generated);

  const groups = new Map<string, AggregatedPackage[]>();
  for (const pkg of dataset.packages) {
    const key = groupKey(pkg.name);
    groups.set(key, [...(groups.get(key) ?? []), pkg]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)));

  const index =
    keys.length > 1
      ? html`<nav class="index" id="index" aria-label="${t.indexLabel}"><ul>${keys.map(
          (key) => html`<li><a href="#${groupId(key)}">${key === '#' ? html`<span aria-hidden="true">#</span><span class="visually-hidden">${t.otherCharacters}</span>` : key}</a></li>`,
        )}</ul></nav>`
      : '';

  const content =
    dataset.packages.length === 0
      ? html`<p class="empty">${t.emptyState}</p>`
      : keys.map((key) => {
          const heading = key === '#' ? t.otherCharacters : key;
          return html`<section class="letter" aria-labelledby="${groupId(key)}"><h2 id="${groupId(key)}">${heading}</h2><ul class="entries">${(groups.get(key) ?? []).map((pkg) => renderEntry(pkg, output, t))}</ul>${
            keys.length > 1 ? html`<a class="back" href="#index">${t.backToIndex}</a>` : ''
          }</section>`;
        });

  // Built only from constants and a base64 digest, so it is safe to emit unescaped.
  const csp = new SafeHtml(`default-src 'none'; style-src 'sha256-${styleHash}'; img-src 'none'; base-uri 'none'; form-action 'none'`);

  const page = html`<!doctype html>
<html lang="${output.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="color-scheme" content="light dark">
<meta name="generator" content="OpenCredits ${dataset.tool.version}">
<title>${title}</title>
<style>${new SafeHtml(styles)}</style>
</head>
<body>
<a class="skip" href="#main">${t.skipLink}</a>
<div class="page">
<header>
<h1>${title}</h1>
<p class="intro">${intro}</p>
<p class="meta">${t.componentCount(dataset.packages.length)}. ${t.lastUpdated}: <time datetime="${dataset.generatedAt}">${dateLabel}</time></p>
${index}
</header>
<main id="main" tabindex="-1">
${content}
</main>
<footer><p>${t.generatedWith}</p></footer>
</div>
</body>
</html>
`;
  return { html: page.value, styleHash };
}

export async function writeSite(outDir: string, dataset: Dataset, output: OutputConfig): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const { html: page } = renderPage(dataset, output);
  const target = join(outDir, 'index.html');
  await writeFile(target, page, 'utf8');
  return target;
}
