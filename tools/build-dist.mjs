#!/usr/bin/env node
/* Assembles the static half of the deploy.
 *
 * The assets directory used to be the repository root, which published the tests,
 * the docs, the contracts and every screenshot along with the app. Nothing there is
 * secret — the repo is public — but shipping it is wasteful and makes the deployed
 * surface something nobody has actually looked at. This copies the four files the
 * page genuinely needs and nothing else.
 */
import { mkdirSync, copyFileSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'docs'), { recursive: true });

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
copyFileSync(join(ROOT, 'index.html'), join(DIST, 'index.html'));
writeFileSync(join(DIST, '.nojekyll'), '');

/* Take exactly what the page references, so a renamed asset fails here loudly
   rather than 404-ing in production. */
/* `poster` counts too, and og:image is an absolute GitHub Pages URL — take
   everything from `docs/` onwards so both spellings resolve to the same file. */
const referenced = [...html.matchAll(/(?:src|href|content|poster)="([^"]*docs\/[^"]+)"/g)]
  .map(m => (m[1].match(/docs\/.*$/) || [m[1]])[0])
  .filter((v, i, a) => a.indexOf(v) === i);

let copied = 0, missing = [];
for (const rel of referenced) {
  const from = join(ROOT, rel);
  if (!existsSync(from)) { missing.push(rel); continue; }
  mkdirSync(dirname(join(DIST, rel)), { recursive: true });
  copyFileSync(from, join(DIST, rel));
  copied++;
}

if (missing.length) {
  console.error('referenced but missing:\n  ' + missing.join('\n  '));
  process.exit(1);
}

const size = readdirSync(join(DIST, 'docs')).reduce((n, f) =>
  n + readFileSync(join(DIST, 'docs', f)).length, 0) + html.length;
console.log(`dist/ built — index.html + ${copied} asset(s), ${(size / 1024 / 1024).toFixed(2)}MB`);
