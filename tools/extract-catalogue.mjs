#!/usr/bin/env node
/*
 * Generates contracts/catalogue.json from the CONFIG objects in index.html.
 *
 * The model is given this catalogue and asked to answer with keys from it, so the
 * catalogue and the app have to describe the same world. Hand-copying the objects
 * would create two lists that drift the first time someone adds a document to one
 * of them. This reads the real source instead.
 *
 *   node tools/extract-catalogue.mjs           write contracts/catalogue.json
 *   node tools/extract-catalogue.mjs --check   exit 1 if the committed file is stale
 *
 * Launch is Hebrew-only, so the catalogue carries Hebrew names alone — the client
 * renders the returned keys through its own i18n, which is why the other three
 * languages cost nothing here and nothing at inference time.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'index.html');
const TARGET = join(ROOT, 'contracts', 'catalogue.json');

const WANTED = ['AGENCIES', 'DOCS', 'TEMPLATES', 'STATUSES'];

/* Pull `const NAME = <literal>;` out of the page by matching braces/brackets.
   The objects are plain literals, so a depth count is enough — no JS parser
   needed, and a parser would be one more thing to keep in step with the file. */
function extractDeclaration(src, name) {
  const start = src.indexOf(`const ${name} = `);
  if (start === -1) throw new Error(`${name} not found in index.html`);

  let i = src.indexOf('=', start) + 1;
  while (' \t\r\n'.includes(src[i])) i++;

  const open = src[i];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) throw new Error(`${name} is not an object or array literal`);

  let depth = 0, inStr = null, escaped = false;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inStr) { if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}

const html = readFileSync(SOURCE, 'utf8');
const source = WANTED.map(n => `globalThis.${n} = ${extractDeclaration(html, n)};`).join('\n');
const sandbox = {};
vm.runInNewContext(source, sandbox, { timeout: 5000 });

const { AGENCIES, DOCS, TEMPLATES, STATUSES } = sandbox;

/* Agencies whose `children` list is the real answer — "which bank", "which health
   fund" — are marked so the prompt can ask for the child rather than settling for
   the umbrella key. `other` is excluded: it exists for the UI, and offering it to
   the model just gives a wrong answer somewhere to hide. */
const agencies = {};
for (const [key, a] of Object.entries(AGENCIES)) {
  if (key === 'other') continue;
  agencies[key] = { he: a.he, tr: a.tr };
  if (Array.isArray(a.children) && a.children.length) {
    agencies[key].children = a.children.map(c => c.he);
  }
}

const docs = {};
for (const [key, d] of Object.entries(DOCS)) docs[key] = { he: d.he, tr: d.tr };

const templates = {};
for (const [key, t] of Object.entries(TEMPLATES)) {
  templates[key] = { he: t.he, agency: t.agency, docs: t.docs };
}

const catalogue = {
  version: 1,
  generated_from: 'index.html',
  language: 'he',
  statuses: STATUSES.map(s => s.key),
  agencies,
  docs,
  templates
};

/* Hash the content, not the file, so reformatting is not a spurious diff. */
const body = JSON.stringify(catalogue, null, 2) + '\n';
catalogue.checksum = createHash('sha256').update(body).digest('hex').slice(0, 16);
const out = JSON.stringify(catalogue, null, 2) + '\n';

const counts = `${Object.keys(agencies).length} agencies, ${Object.keys(docs).length} documents, ${Object.keys(templates).length} processes`;

if (process.argv.includes('--check')) {
  let current = null;
  try { current = readFileSync(TARGET, 'utf8'); } catch { /* missing counts as stale */ }
  if (current !== out) {
    console.error('contracts/catalogue.json is out of date with index.html.');
    console.error('Run: node tools/extract-catalogue.mjs');
    process.exit(1);
  }
  console.log(`catalogue.json is current — ${counts}`);
} else {
  writeFileSync(TARGET, out);
  console.log(`wrote contracts/catalogue.json — ${counts}, checksum ${catalogue.checksum}`);
}
