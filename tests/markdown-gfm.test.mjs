import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import esbuild from 'esbuild';

/* markdown.jsx is JSX; transpile once to a throwaway module beside this file
 * so bare imports (`react`) resolve against the project node_modules. */
const outFile = new URL('./__markdown.compiled.mjs', import.meta.url);
const src = readFileSync(new URL('../src/runtime/markdown.jsx', import.meta.url), 'utf8');
const { code } = esbuild.transformSync(src, { loader: 'jsx', format: 'esm' });
writeFileSync(outFile, code);
const md = await import('./__markdown.compiled.mjs');
rmSync(outFile);

const render = content => renderToStaticMarkup(React.createElement(md.Markdown, { content }));

test('horizontal rules parse to hr blocks', () => {
  for (const src of ['---', '- - -', '***', '* * *', '___']) {
    assert.deepEqual(md.parseBlocks(src), [{ type: 'hr' }], src);
  }
  assert.match(render('intro\n\n---\n\noutro'), /<hr class="md-hr"\/?>/);
});

test('table parses headers, alignments and rows', () => {
  const blocks = md.parseBlocks(
    '| Komponen | Status | Protokol |\n' +
    '|:---|:---:|---:|\n' +
    '| Core Window | Berjalan | COM / WebView2 |\n' +
    '| Shell | Berjalan | WebView2 |'
  );
  assert.equal(blocks.length, 1);
  const [t] = blocks;
  assert.equal(t.type, 'table');
  assert.deepEqual(t.headers, ['Komponen', 'Status', 'Protokol']);
  assert.deepEqual(t.aligns, ['left', 'center', 'right']);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0], ['Core Window', 'Berjalan', 'COM / WebView2']);
  /* short rows pad to header width, long rows truncate (GFM) */
  assert.equal(t.rows[1].length, 3);
});

test('table renders wrapped markup with per-cell alignment', () => {
  const html = render('| a | b |\n|:---:|---:|\n| 1 | 2 |');
  assert.match(html, /<div class="table-wrap">/);
  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<thead>/);
  assert.match(html, /<th style="text-align:center">a<\/th>/);
  assert.match(html, /<td style="text-align:right">2<\/td>/);
  assert.match(html, /<tbody>/);
});

test('mismatched header/delimiter stays a paragraph', () => {
  const blocks = md.parseBlocks('| a | b |\n|---|\n| 1 | 2 |');
  assert.ok(blocks.every(b => b.type !== 'table'));
});

test('links parse and render safely', () => {
  const [link] = md.parseInline('[canoPi](https://canopi.dev/docs "Docs")');
  assert.equal(link.type, 'link');
  assert.equal(link.href, 'https://canopi.dev/docs');
  const html = render('Go to [canoPi](https://canopi.dev) now');
  assert.match(html, /<a href="https:\/\/canopi\.dev" target="_blank" rel="noopener noreferrer">canoPi<\/a>/);
  /* bare URL */
  const bare = md.parseInline('see https://canopi.dev/x');
  assert.ok(bare.some(n => n !== 'string' && typeof n === 'object' && n.type === 'link' && n.href === 'https://canopi.dev/x'));
});

test('hostile URLs are rejected', () => {
  assert.equal(md.safeUrl('javascript:alert(1)'), null);
  assert.equal(md.safeUrl('JAVASCRIPT:alert(1)'), null);
  assert.equal(md.safeUrl('java\nscript:alert(1)'), null);
  assert.equal(md.safeUrl('data:text/html;base64,PHNjcmlwdD4='), null);
  assert.equal(md.safeUrl('vbscript:msgbox(1)'), null);
  assert.equal(md.safeUrl('//evil.example/x'), null);
  assert.equal(md.safeUrl('https://ok.example/'), 'https://ok.example/');
  assert.equal(md.safeUrl('http://ok.example/'), 'http://ok.example/');
  assert.equal(md.safeUrl('mailto:a@b.example'), 'mailto:a@b.example');
  assert.equal(md.safeUrl('/docs/index.html'), '/docs/index.html');
  const html = render('[x](javascript:alert(1))');
  assert.doesNotMatch(html, /<a /);
  assert.doesNotMatch(html, /javascript:/);
});

test('strikethrough parses to del', () => {
  const [d] = md.parseInline('~~gone~~');
  assert.equal(d.type, 'del');
  assert.match(render('~~gone~~'), /<del>gone<\/del>/);
});

test('task lists render disabled checkboxes', () => {
  const blocks = md.parseBlocks('- [x] done\n- [ ] todo\n- plain');
  assert.equal(blocks[0].type, 'ul');
  const html = render(blocks.length ? '- [x] done\n- [ ] todo\n- plain' : '');
  assert.match(html, /<input type="checkbox"[^>]*checked[^>]*>/);
  assert.match(html, /disabled/);
  assert.match(html, /todo/);
  assert.match(html, /<li>plain<\/li>/);
});

test('bold, italic, code still work alongside new syntax', () => {
  const html = render('**b** *i* `c` ~~s~~ [l](https://a.example)');
  assert.match(html, /<strong>b<\/strong>/);
  assert.match(html, /<em>i<\/em>/);
  assert.match(html, /<code>c<\/code>/);
  assert.match(html, /<del>s<\/del>/);
  assert.match(html, /<a href="https:\/\/a\.example"/);
});

test('inline math renders as code.md-math-inline', () => {
  const blocks = md.parseBlocks('$E=mc^2$ inline');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'p');
  const html = render('$E=mc^2$ inline');
  assert.match(html, /<code class="md-math-inline">E=mc\^2<\/code>/);
});

test('block math renders as div.md-math', () => {
  const blocks = md.parseBlocks('$$\nE=mc^2\n$$');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'math');
  assert.match(blocks[0].text, /E=mc\^2/);
  const html = render('$$\nE=mc^2\n$$');
  assert.match(html, /<div class="md-math"[^>]*>/);
  assert.match(html, /E=mc\^2/);
});

test('details/summary parse and render', () => {
  const blocks = md.parseBlocks('<details>\n<summary>Click me</summary>\nHidden content\n</details>');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'details');
  assert.equal(blocks[0].summary, 'Click me');
  assert.match(blocks[0].content, /Hidden content/);
  const html = render('<details>\n<summary>Click me</summary>\nHidden content\n</details>');
  assert.match(html, /<details class="md-details"[^>]*>/);
  assert.match(html, /<summary>Click me<\/summary>/);
  assert.match(html, /<div class="md-details-body">/);
});

test('task list renders without bullet and checkbox', () => {
  const blocks = md.parseBlocks('- [ ] Task 1\n- [x] Task 2');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'ul');
  assert.ok(blocks[0].isTask);
  assert.equal(blocks[0].items.length, 2);
  const html = render('- [ ] Task 1\n- [x] Task 2');
  assert.match(html, /<ul class="task-list">/);
  assert.match(html, /<input type="checkbox" disabled[^>]*>/);
  assert.match(html, /Task 1/);
  assert.match(html, /Task 2/);
});

test('diff highlighting in code blocks', () => {
  const blocks = md.parseBlocks('```diff\n- old line\n+ new line\n```');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].lang, 'diff');
  const html = render('```diff\n- old line\n+ new line\n```');
  assert.match(html, /<span class="diff-del">- old line/);
  assert.match(html, /<span class="diff-add">\+ new line/);
});
