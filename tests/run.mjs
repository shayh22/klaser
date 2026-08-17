#!/usr/bin/env node
/* Runs every suite and reports one number. Browser suites need the static server
   on 8099; this starts it, so `node tests/run.mjs` is the whole story. */
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;

const http = spawn('python3', ['-m', 'http.server', '8099', '--bind', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));

let pass = 0, fail = 0, crashed = [];
const files = readdirSync(HERE).filter(f => f.endsWith('.mjs') && f !== 'run.mjs').sort();

for (const f of files) {
  const r = spawnSync('node', [HERE + f], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const p = (out.match(/^\s*(PASS|ok|✓)/gm) || []).length;
  const x = (out.match(/^\s*(FAIL|✗)/gm) || []).length;
  const n = (out.match(/(\d+) passed, (\d+) failed/) || []);
  const P = n.length ? +n[1] : p, F = n.length ? +n[2] : x;
  pass += P; fail += F;
  if (r.status !== 0 && F === 0) crashed.push(f);
  console.log(`${f.padEnd(22)} ${String(P).padStart(3)} passed  ${String(F).padStart(2)} failed${r.status ? '  (exit ' + r.status + ')' : ''}`);
  if (F) console.log(out.split('\n').filter(l => /^\s*(FAIL|✗)/.test(l)).map(l => '    ' + l).join('\n'));
}

http.kill();
console.log(`\n${pass} passed, ${fail} failed` + (crashed.length ? `, crashed: ${crashed.join(', ')}` : ''));
process.exit(fail || crashed.length ? 1 : 0);
