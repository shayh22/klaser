#!/usr/bin/env node
/* Local dev server. Runs the exact Worker handler on Node's http server, so what is
 * tested here is the code that deploys, not a parallel implementation.
 *
 *   node server/dev.js                 mock adapter, port 8787
 *   ANTHROPIC_API_KEY=sk-… node server/dev.js    real models
 */

import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp } from './index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogue = JSON.parse(readFileSync(join(ROOT, 'contracts', 'catalogue.json'), 'utf8'));

const PORT = Number(process.env.PORT || 8787);

/* The Workers static-assets binding, backed by the repository. Same interface, so
   the Worker code path is identical in dev and in production. */
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
  '.webp':'image/webp', '.mp4':'video/mp4', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

const assets = {
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/') p = '/index.html';
    if (p.includes('..')) return new Response('no', { status: 400 });
    const file = join(ROOT, p);
    try {
      if (!statSync(file).isFile()) return new Response('not found', { status: 404 });
    } catch { return new Response('not found', { status: 404 }); }
    const ext = p.slice(p.lastIndexOf('.'));
    return new Response(readFileSync(file), {
      headers: { 'content-type': TYPES[ext] || 'application/octet-stream' }
    });
  }
};

const app = createApp({
  catalogue,
  assets,
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    FREE_CREDITS: process.env.FREE_CREDITS || '10',
    DAILY_SPEND_CAP_USD: process.env.DAILY_SPEND_CAP_USD || '25',
    KILL_SWITCH: process.env.KILL_SWITCH || '',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '*'
  }
});

export function nodeAdapter(app) {
  return async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : body
    });
    const out = await app(request);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  };
}

if (process.argv[1] && process.argv[1].endsWith('dev.js')) {
  createServer(nodeAdapter(app)).listen(PORT, () => {
    const mode = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock (no API key set)';
    console.log(`klaser server on http://localhost:${PORT} — provider: ${mode}`);
  });
}

export { app, catalogue };
