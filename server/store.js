/* Token and credit accounting.
 *
 * Two implementations behind one interface: D1 in production, an in-memory map for
 * `wrangler dev` and for the tests. Neither ever holds document content — the only
 * columns are a token id, a counter and a reset date. There is no table a document
 * could be written to, which is a stronger guarantee than a policy saying it is not.
 */

const PERIOD_DAYS = 30;

function periodEnd(now = Date.now()) {
  return new Date(now + PERIOD_DAYS * 86400_000).toISOString();
}

function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export class MemoryStore {
  constructor({ freeCredits = 10 } = {}) {
    this.freeCredits = freeCredits;
    this.tokens = new Map();
    this.spendToday = 0;
    this.spendDay = new Date().toISOString().slice(0, 10);
  }

  async issue() {
    const token = randomToken();
    const row = { used: 0, limit: this.freeCredits, resets_at: periodEnd(), rate: [] };
    this.tokens.set(token, row);
    return { token, quota: this.quotaOf(row), expires_at: row.resets_at };
  }

  async get(token) {
    const row = this.tokens.get(token);
    if (!row) return null;
    if (Date.parse(row.resets_at) < Date.now()) { row.used = 0; row.resets_at = periodEnd(); }
    return row;
  }

  quotaOf(row) {
    return { limit: row.limit, remaining: Math.max(0, row.limit - row.used), resets_at: row.resets_at };
  }

  /* Charged only after a successful read. A failed or unreadable analysis costs the
     user nothing — they got nothing useful. */
  async charge(token, credits) {
    const row = await this.get(token);
    if (!row) return null;
    row.used += credits;
    return this.quotaOf(row);
  }

  /* Sliding window, per token — burst protection only, deliberately looser than the
     credit quota. If it were tighter, a user who ran out would be told "too many
     requests" instead of "you are out of credits", which is both opaque and wrong.
     The real defence against scraping is the global spend cap below. */
  async rateOk(token, { max = 20, windowMs = 60_000 } = {}) {
    const row = await this.get(token);
    if (!row) return false;
    const now = Date.now();
    row.rate = row.rate.filter(t => now - t < windowMs);
    if (row.rate.length >= max) return false;
    row.rate.push(now);
    return true;
  }

  async addSpend(usd) {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.spendDay) { this.spendDay = day; this.spendToday = 0; }
    this.spendToday += usd;
    return this.spendToday;
  }

  async spend() {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.spendDay) { this.spendDay = day; this.spendToday = 0; }
    return this.spendToday;
  }
}

export class D1Store extends MemoryStore {
  constructor(db, opts) { super(opts); this.db = db; }

  async issue() {
    const token = randomToken();
    const resets = periodEnd();
    await this.db.prepare(
      'INSERT INTO tokens (token, used, credit_limit, resets_at) VALUES (?, 0, ?, ?)'
    ).bind(token, this.freeCredits, resets).run();
    return { token, quota: { limit: this.freeCredits, remaining: this.freeCredits, resets_at: resets }, expires_at: resets };
  }

  async get(token) {
    const r = await this.db.prepare(
      'SELECT token, used, credit_limit AS "limit", resets_at FROM tokens WHERE token = ?'
    ).bind(token).first();
    if (!r) return null;
    if (Date.parse(r.resets_at) < Date.now()) {
      const resets = periodEnd();
      await this.db.prepare('UPDATE tokens SET used = 0, resets_at = ? WHERE token = ?').bind(resets, token).run();
      return { ...r, used: 0, resets_at: resets };
    }
    return r;
  }

  async charge(token, credits) {
    await this.db.prepare('UPDATE tokens SET used = used + ? WHERE token = ?').bind(credits, token).run();
    const row = await this.get(token);
    return row ? this.quotaOf(row) : null;
  }

  async rateOk() { return true; }   /* Workers rate limiting binding handles this in prod */

  async addSpend(usd) {
    const day = new Date().toISOString().slice(0, 10);
    await this.db.prepare(
      'INSERT INTO spend (day, usd) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET usd = usd + ?'
    ).bind(day, usd, usd).run();
    return this.spend();
  }

  async spend() {
    const day = new Date().toISOString().slice(0, 10);
    const r = await this.db.prepare('SELECT usd FROM spend WHERE day = ?').bind(day).first();
    return r ? r.usd : 0;
  }
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tokens (
  token        TEXT PRIMARY KEY,
  used         INTEGER NOT NULL DEFAULT 0,
  credit_limit INTEGER NOT NULL,
  resets_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spend (
  day TEXT PRIMARY KEY,
  usd REAL NOT NULL DEFAULT 0
);
`;
