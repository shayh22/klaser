/* Mock adapter.
 *
 * Exists so the whole flow — client, consent, quota, review, form fill — can be run
 * and tested end to end without an API key, a bill, or a network. It is not a stub
 * that returns nothing: it returns realistic Hebrew fixtures shaped exactly like the
 * real schema, so a test that passes here is a test of the pipeline rather than of
 * the mock.
 *
 * A caller can steer it by sending an image whose bytes begin with `KLASER-MOCK:`
 * followed by JSON. That is how the tests drive the low-confidence, not-a-letter and
 * quota paths without needing a photograph of each.
 */

const DEFAULT = {
  identify: {
    is_letter: true,
    agency: 'btl',
    agency_he: 'ביטוח לאומי',
    form_code: 'בל/5020',
    form_title_he: 'בקשה לקצבת ילדים',
    personalised: false
  },
  read: {
    agency: 'btl',
    agency_he: 'ביטוח לאומי',
    agency_child: null,
    template: 'child_allowance',
    /* One document with no catalogue key, deliberately: it is the ordinary case now,
       not the exception, and every test that runs on the mock should see it. */
    required_docs: [
      { key: 'teudat_zehut', he: 'תעודת זהות',        evidence: 'צילום תעודת זהות של שני ההורים', confidence: 0.96 },
      { key: 'sefach',       he: 'ספח תעודת זהות',    evidence: 'ספח תעודת הזהות שבו רשומים הילדים', confidence: 0.93 },
      { key: 'bank_confirm', he: 'אישור ניהול חשבון', evidence: 'אישור ניהול חשבון בנק על שם התובע', confidence: 0.95 },
      { key: 'claim_form',   he: 'טופס תביעה',        evidence: 'טופס התביעה המצורף, חתום', confidence: 0.9 },
      { key: null, he: 'תעודת לידה של הילד שנולד בחו״ל', evidence: 'עבור ילד שנולד מחוץ לישראל יש לצרף תעודת לידה מתורגמת', confidence: 0.72 }
    ],
    deadline: null,
    letter_date: '2026-08-02',
    reference: '304-882-1177',
    form_code: 'בל/5020',
    form_title_he: 'בקשה לקצבת ילדים',
    form_to_fill: { where: 'self', form_code: 'בל/5020', form_title_he: 'בקשה לקצבת ילדים' },
    personalised: false,
    confidence: 0.91,
    language: 'he'
  }
};

function decodeDirective(b64) {
  if (!b64) return null;
  let text;
  try {
    text = typeof atob === 'function'
      ? atob(b64.slice(0, 2048))
      : Buffer.from(b64.slice(0, 2048), 'base64').toString('utf8');
  } catch { return null; }
  if (!text.startsWith('KLASER-MOCK:')) return null;
  try { return JSON.parse(text.slice('KLASER-MOCK:'.length)); } catch { return null; }
}

export function createMockAdapter({ latencyMs = 0 } = {}) {
  const wait = () => latencyMs ? new Promise(r => setTimeout(r, latencyMs)) : Promise.resolve();

  async function respond(kind, image) {
    await wait();
    const d = decodeDirective(image);
    if (d && d.fail) { const e = new Error('mock upstream failure'); e.status = 503; throw e; }
    const base = structuredClone(DEFAULT[kind]);
    const merged = d && d[kind] ? { ...base, ...d[kind] } : base;
    return {
      parsed: merged,
      usage: kind === 'identify'
        ? { input_tokens: 2600, output_tokens: 60, cache_read_input_tokens: 1600 }
        : { input_tokens: 2700, output_tokens: 480, cache_read_input_tokens: 1600 },
      model: kind === 'identify' ? 'mock-haiku' : 'mock-sonnet'
    };
  }

  return {
    name: 'mock',
    identify: ({ image }) => respond('identify', image),
    read:     ({ image }) => respond('read', image),
    escalate: ({ image }) => respond('read', image),
    costOf: () => 0
  };
}
