// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { aggregatePackages } from '../src/aggregate/aggregate.js';
import { parseConfig } from '../src/config/config.js';
import { buildStyles, renderPage } from '../src/render/render.js';
import { escapeHtml, html } from '../src/render/template.js';
import { contrastRatio } from '../src/util/contrast.js';
import { ConfigError } from '../src/util/errors.js';
const output = parseConfig({}, '/tmp').output;
function details(name, overrides = {}) {
    return {
        name,
        version: '1.0.0',
        ecosystem: 'npm',
        purl: `pkg:npm/${name}@1.0.0`,
        license: { expression: 'MIT', raw: 'MIT' },
        licenseText: `MIT License\n\nCopyright (c) 2024 ${name} authors`,
        noticeText: null,
        copyrights: [`Copyright (c) 2024 ${name} authors`],
        homepage: `https://github.com/example/${name}`,
        repositories: ['secret-org/internal-repo'],
        flags: [],
        ...overrides,
    };
}
function dataset(packages) {
    return { schemaVersion: '1.0', generatedAt: '2026-09-16T02:00:00.000Z', tool: { name: 'opencredits', version: '0.1.0' }, packages: aggregatePackages(packages) };
}
describe('template escaping', () => {
    it('escapes interpolations but not nested SafeHtml', () => {
        assert.equal(escapeHtml(`<a href="x" onclick='y'>&\``), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;');
        assert.equal(html `<p>${'<b>'}${html `<i>ok</i>`}</p>`.value, '<p>&lt;b&gt;<i>ok</i></p>');
    });
});
describe('renderPage', () => {
    it('neutralises malicious package metadata', () => {
        const { html: page } = renderPage(dataset([
            details('evil', {
                name: '<script>alert(1)</script>',
                licenseText: '</pre><img src=x onerror=alert(1)>',
                copyrights: ['<svg onload=alert(1)>'],
                homepage: 'javascript:alert(1)',
                license: { expression: null, raw: '"><script>x</script>' },
            }),
        ]), output);
        assert.equal(page.includes('<script'), false);
        assert.equal(page.includes('<img'), false);
        assert.equal(page.includes('<svg'), false);
        assert.equal(page.includes('javascript:'), false);
        assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    });
    it('never publishes repository names or versions by default', () => {
        const { html: page } = renderPage(dataset([details('react', { version: '18.3.1' })]), output);
        assert.equal(page.includes('secret-org'), false);
        assert.equal(page.includes('18.3.1'), false);
        const withVersions = renderPage(dataset([details('react', { version: '18.3.1' })]), { ...output, showVersions: true });
        assert.equal(withVersions.html.includes('18.3.1'), true);
    });
    it('allows the inline stylesheet by hash in a strict CSP', () => {
        const { html: page, styleHash } = renderPage(dataset([details('a')]), output);
        const styles = buildStyles(output.accentColor, output.accentColorDark);
        assert.equal(styleHash, createHash('sha256').update(styles).digest('base64'));
        assert.match(page, new RegExp(`default-src 'none'; style-src 'sha256-${styleHash.replace(/[+/=]/g, '\\$&')}'`));
        assert.equal(page.includes('<script'), false, 'the page works without JavaScript');
    });
    it('produces an accessible document structure', () => {
        const { html: page } = renderPage(dataset([details('axios'), details('Zod'), details('@angular/core'), details('3d-lib')]), { ...output, language: 'de' });
        assert.match(page, /<html lang="de">/);
        assert.match(page, /<a class="skip" href="#main">/);
        assert.match(page, /<main id="main"/);
        assert.equal((page.match(/<h1>/g) ?? []).length, 1);
        assert.match(page, /<nav class="index" id="index" aria-label="Komponenten nach Anfangsbuchstabe">/);
        assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
        assert.equal(page.includes('user-scalable'), false, 'zooming must stay possible');
        const ids = [...page.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
        assert.equal(new Set(ids).size, ids.length, 'ids are unique');
        for (const ref of [...page.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1])) {
            assert.ok(ids.includes(ref), `aria-labelledby target ${ref} exists`);
        }
        for (const href of [...page.matchAll(/href="#([^"]+)"/g)].map((match) => match[1])) {
            assert.ok(ids.includes(href), `in-page link target ${href} exists`);
        }
        const headingLevels = [...page.matchAll(/<h([1-6])/g)].map((match) => Number(match[1]));
        headingLevels.reduce((previous, level) => {
            assert.ok(level <= previous + 1, `heading levels do not skip (h${previous} -> h${level})`);
            return level;
        }, 0);
        assert.ok(page.indexOf('id="letter-a"') < page.indexOf('id="letter-z"'));
        assert.ok(page.indexOf('id="letter-z"') < page.indexOf('id="letter-other"'), 'non-letters are listed last');
    });
    it('shows an empty state and an SPDX link fallback', () => {
        assert.match(renderPage(dataset([]), output).html, /class="empty"/);
        const { html: page } = renderPage(dataset([details('nolicensefile', { licenseText: null })]), output);
        assert.match(page, /https:\/\/spdx\.org\/licenses\/MIT\.html/);
    });
});
describe('parseConfig', () => {
    it('applies secure defaults', () => {
        const config = parseConfig({}, '/work');
        assert.equal(config.source.type, 'local');
        assert.equal(config.output.showVersions, false);
        assert.equal(config.output.stripEmails, true);
        assert.equal(config.extraction.mode, 'manifests');
        assert.equal(config.extraction.includeDevDependencies, false);
    });
    it('rejects unsafe or invalid settings with every problem listed', () => {
        assert.throws(() => parseConfig({
            source: { type: 'github', apiUrl: 'http://evil.example', organizations: ['bad org'] },
            output: { accentColor: '#FFFF00', language: 'fr' },
            relevance: { deploymentDomains: ['not a domain'] },
            unknownKey: true,
        }, '/work'), (error) => {
            assert.ok(error instanceof ConfigError);
            const text = error.problems.join('\n');
            assert.match(text, /apiUrl must be an https URL/);
            assert.match(text, /organizations contains an invalid value/);
            assert.match(text, /accentColor #FFFF00 has contrast/);
            assert.match(text, /language must be one of/);
            assert.match(text, /deploymentDomains contains an invalid value/);
            assert.match(text, /unknownKey is not a known setting/);
            return true;
        });
    });
    it('accepts brand colors that meet WCAG AA', () => {
        assert.ok(contrastRatio('#1F5F8B', '#FFFFFF') >= 4.5);
        assert.doesNotThrow(() => parseConfig({ output: { accentColor: '#C4001A' } }, '/work'));
    });
});
//# sourceMappingURL=render.test.js.map