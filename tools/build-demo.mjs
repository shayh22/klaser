#!/usr/bin/env node
/* Packages index.html as a single self-contained page for the Artifact host.
 *
 * Three differences from the real app, all forced rather than optional:
 *   - demo mode is on, so the flow runs with no server and no network;
 *   - the hero video is dropped, since its file is not published alongside;
 *   - the <html>/<head>/<body> wrappers are removed, because the host supplies them.
 * Everything else is the shipping file, byte for byte.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) { console.error('usage: build-demo.mjs <output.html>'); process.exit(1); }

let s = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* The shipping title is a name plus a description of the site, which reads as
   filler when the page is a demo sitting in a gallery. Name it for what it is. */
const title = 'Klaser Demo';
const style = (s.match(/<style>[\s\S]*?<\/style>/) || [])[0] || '';
const body  = s.slice(s.indexOf('<body>') + 6, s.lastIndexOf('</body>'));

/* The host supplies <head>, which takes <meta charset> with it. Every real host
   sends charset=utf-8 in the Content-Type, but a page of Hebrew should not depend
   on that — browsers honour a late declaration by reparsing. */
let page = `<meta charset="utf-8">\n<title>${title}</title>\n${style}\n${body}`;

/* the video and poster are not published with this page — remove rather than 404 */
page = page.replace(/<div class="hero"[\s\S]*?<\/div>\s*(?=<h1)/, '');

/* force demo mode without relying on a query string surviving a shared link */
page = page.replace('<script>', '<script>\nwindow.KLASER_AI_ENDPOINT = "demo";\n');

writeFileSync(out, page);
console.log(`wrote ${out} — ${(page.length / 1024).toFixed(0)}KB`);
