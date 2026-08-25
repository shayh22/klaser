/* What the OpenRouter adapter puts on the wire, and what it does with the answer.
 *
 * Same standard as tests/adaptertest.mjs and the same caveat: fetch is replaced, so
 * this proves the request is the shape the documentation describes, not that the
 * gateway accepts it. Only tools/probe-live.mjs proves that. It exists because the
 * three differences from the Anthropic path — data URLs, the file part, strict-mode
 * schema — are all silent failures rather than loud ones. A PDF sent the wrong way
 * does not error; the model reads a blank page and returns an empty, confident list.
 */
import { createOpenRouterAdapter, normaliseSchema, costOf } from '../server/adapters/openrouter.js';
import { createAnalyzer } from '../server/analyze.js';
import { chooseAdapter } from '../server/index.js';
import { analysisSchema } from '../server/prompts.js';
import { readFileSync } from 'node:fs';

const catalogue = JSON.parse(readFileSync(new URL('../contracts/catalogue.json', import.meta.url).pathname, 'utf8'));
let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

const READ = {
  agency: 'btl', agency_child: null, template: 'child_allowance',
  required_docs: [{ key: 'teudat_zehut', evidence: 'צילום תעודת זהות', confidence: 0.9 }],
  extra_docs: [], deadline: null, letter_date: null, reference: null,
  form_code: 'בל/5020', form_title_he: 'בקשה לקצבת ילדים',
  form_to_fill: { where: 'self', form_code: null, form_title_he: null },
  personalised: false, confidence: 0.9, language: 'he'
};
const IDENT = { is_letter: true, agency: 'btl', form_code: 'בל/5020',
                form_title_he: 'בקשה לקצבת ילדים', personalised: false };

let sent = [];
let reply = null;          /* override the next response body */
const fakeFetch = async (url, opts) => {
  sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
  const body = reply || {
    model: sent[sent.length - 1].body.model,
    choices: [{ message: { content: JSON.stringify(sent.length === 1 ? IDENT : READ) } }],
    usage: { prompt_tokens: 3000, completion_tokens: 400,
             prompt_tokens_details: { cached_tokens: 1500 }, cost: 0.004 }
  };
  reply = null;
  return { ok: true, json: async () => body };
};

const adapter = createOpenRouterAdapter({ apiKey: 'sk-or-test', fetchImpl: fakeFetch });
const analyze = createAnalyzer({ adapter, catalogue });

/* ---- an image ---- */
const out = await analyze({ image: 'AAAA', mediaType: 'image/jpeg' });
ok('two calls: identify then read', sent.length === 2);

const [ident, read] = sent;
ok('the gateway endpoint is used', ident.url === 'https://openrouter.ai/api/v1/chat/completions');
ok('key travels as a bearer token', ident.headers.authorization === 'Bearer sk-or-test');
ok('the app identifies itself', ident.headers['x-title'] === 'Klaser');
ok('identify uses the cheap model', ident.body.model === 'anthropic/claude-haiku-4.5');
ok('read uses the mid model', read.body.model === 'anthropic/claude-sonnet-4.5');

/* the three shapes that fail silently */
const imgPart = read.body.messages[1].content[0];
ok('an image is an image_url part', imgPart.type === 'image_url');
ok('the image is a data URL, not bare base64', imgPart.image_url.url === 'data:image/jpeg;base64,AAAA');
ok('instruction follows the image', read.body.messages[1].content[1].type === 'text');
ok('no file-parser plugin for an image', !read.body.plugins);

ok('system is its own message', read.body.messages[0].role === 'system');
ok('the catalogue is the cached part', !!read.body.messages[0].content[1].cache_control);
ok('the prompt itself is not cached', !read.body.messages[0].content[0].cache_control);
ok('the cached part is the catalogue', read.body.messages[0].content[1].text.includes('"agencies"'));

const js = read.body.response_format.json_schema;
ok('structured output requested', read.body.response_format.type === 'json_schema');
ok('schema is sent strict', js.strict === true);
ok('schema enums come from the catalogue',
  js.schema.properties.agency.enum.includes('btl') && js.schema.properties.agency.enum.includes(null));
ok('doc keys are constrained to the catalogue',
  js.schema.properties.required_docs.items.properties.key.enum.length === Object.keys(catalogue.docs).length);
ok('the model cannot invent an agency', !js.schema.properties.agency.enum.includes('made_up'));
ok('max_tokens leaves room for the answer', read.body.max_tokens >= 2000);

/* routing: the privacy position, expressed as provider preferences */
ok('only providers honouring the schema', read.body.provider.require_parameters === true);
ok('no provider that retains the letter', read.body.provider.zdr === true);
ok('no provider that collects data', read.body.provider.data_collection === 'deny');
ok('the real cost is requested', read.body.usage.include === true);

ok('the result came back parsed', out.result.template === 'child_allowance');
ok('a read is charged one credit', out.credits === 1);
ok('nothing was dropped by the catalogue check', out.meta.dropped === 0);

/* ---- usage and cost ---- */
ok('cached tokens are not double-counted as fresh input',
  out.meta.input_tokens === 3000 /* (3000-1500) twice */ && out.meta.cache_read_tokens === 3000);
ok('cost is what the gateway charged, not an estimate', Math.abs(out.costUsd - 0.008) < 1e-9);
ok('cost falls back to the table when the gateway is silent',
  costOf('anthropic/claude-sonnet-4.5', { input_tokens: 1e6, output_tokens: 0 }) === 3);
ok('an unknown slug still prices rather than throwing',
  costOf('some/new-model', { input_tokens: 1e6, output_tokens: 0 }) === 3);

/* ---- a PDF: the shape that fails without erroring ---- */
sent = [];
await analyze({ image: 'AAAA', mediaType: 'application/pdf' });
const filePart = sent[1].body.messages[1].content[0];
ok('a PDF is a file part, not an image_url', filePart.type === 'file');
ok('the PDF travels as a data URL', filePart.file.file_data === 'data:application/pdf;base64,AAAA');
ok('the filename carries the extension the parser reads', filePart.file.filename.endsWith('.pdf'));
ok('the file-parser plugin is named', sent[1].body.plugins[0].id === 'file-parser');
ok('the pdf engine is chosen explicitly', sent[1].body.plugins[0].pdf.engine === 'native');

/* ---- strict mode is not the schema we hand Anthropic ---- */
const strict = normaliseSchema(analysisSchema(catalogue));
ok('every property is required in strict mode',
  strict.required.length === Object.keys(strict.properties).length);
ok('agency_child is required too, though it may be null',
  strict.required.includes('agency_child'));
ok('nested objects are made strict as well',
  strict.properties.form_to_fill.required.includes('form_code')
  && strict.properties.form_to_fill.additionalProperties === false);
ok('length caps are dropped, not sent', !('maxLength' in strict.properties.reference));
ok('item caps are dropped, not sent', !('maxItems' in strict.properties.required_docs));
ok('ranges are dropped, not sent', !('minimum' in strict.properties.confidence));
ok('the enums that matter survive untouched',
  strict.properties.template.enum.length === Object.keys(catalogue.templates).length + 1);
ok('normalising does not mutate the original',
  'maxLength' in analysisSchema(catalogue).properties.reference);

/* ---- answers that are not what was asked for ---- */
sent = [];
reply = { choices: [{ message: { content: '```json\n' + JSON.stringify(IDENT) + '\n```' } }], usage: {} };
const fenced = await adapter.identify({ system: 's', instruction: 'i', schema: {} });
ok('a fenced answer is still read', fenced.parsed.is_letter === true);

reply = { error: { code: 429, message: 'rate limited upstream' } };
let caught = null;
try { await adapter.identify({ system: 's', instruction: 'i', schema: {} }); } catch (e) { caught = e; }
ok('a 200 carrying an error object is an error', !!caught);
ok('the upstream message is kept for the log', (caught.body || '').includes('rate limited upstream'));

reply = { choices: [{ message: { refusal: 'I cannot help with that' } }], usage: {} };
caught = null;
try { await adapter.identify({ system: 's', instruction: 'i', schema: {} }); } catch (e) { caught = e; }
ok('a refusal is an error, not an empty checklist', !!caught);

reply = { choices: [{ message: { content: 'sorry, no.' } }], usage: {} };
caught = null;
try { await adapter.identify({ system: 's', instruction: 'i', schema: {} }); } catch (e) { caught = e; }
ok('prose where JSON was required is an error', caught && caught.status === 502);

/* an upstream failure must reach the pipeline as upstream_error, with its body */
reply = null;
const failing = createOpenRouterAdapter({
  apiKey: 'k',
  fetchImpl: async () => ({ ok: false, status: 402, text: async () => 'insufficient credits' })
});
caught = null;
try { await createAnalyzer({ adapter: failing, catalogue })({ image: 'A', mediaType: 'image/jpeg' }); }
catch (e) { caught = e; }
ok('an HTTP failure surfaces as upstream_error', caught && caught.code === 'upstream_error');
ok('the upstream body is not discarded', (caught.upstreamBody || '').includes('insufficient credits'));

/* ---- a key is not optional ---- */
let threw = false;
try { createOpenRouterAdapter({ apiKey: '' }); } catch { threw = true; }
ok('no key is a startup error, not a runtime one', threw);

/* ---- which provider answers ----
   Decided by which key is present, because a key with no provider configured to
   use it is the deploy mistake worth designing out entirely. */
ok('a key alone selects the gateway',
  chooseAdapter({ OPENROUTER_API_KEY: 'k' }).name === 'openrouter');
ok('the gateway wins when both keys are set',
  chooseAdapter({ OPENROUTER_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' }).name === 'openrouter');
ok('a deliberate choice overrides that',
  chooseAdapter({ AI_PROVIDER: 'anthropic', OPENROUTER_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' }).name === 'anthropic');
ok('the direct key still works alone',
  chooseAdapter({ ANTHROPIC_API_KEY: 'a' }).name === 'anthropic');
ok('no key at all is the mock, not a crash', chooseAdapter({}).name === 'mock');
ok('asking for the gateway without a key does not throw',
  chooseAdapter({ AI_PROVIDER: 'openrouter' }).name === 'mock');
ok('the mock can be forced on a real deployment',
  chooseAdapter({ AI_PROVIDER: 'mock', OPENROUTER_API_KEY: 'k' }).name === 'mock');
ok('slugs can be overridden without a deploy',
  chooseAdapter({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL_READ: 'google/gemini-3-pro' })
    .models.read === 'google/gemini-3-pro');
ok('an unset slug keeps its default',
  chooseAdapter({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL_READ: 'google/gemini-3-pro' })
    .models.identify === 'anthropic/claude-haiku-4.5');

/* The routing restrictions are the privacy position. Turning them off has to be
   something someone typed, never something that happens by omission. */
async function providerBlockFor(env) {
  let captured = null;
  const spy = async (url, opts) => {
    captured = JSON.parse(opts.body).provider;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(IDENT) } }], usage: {} }) };
  };
  const ad = createOpenRouterAdapter({
    apiKey: 'k', fetchImpl: spy,
    zdr: String(env.OPENROUTER_ZDR ?? '1') !== '0',
    dataCollection: String(env.OPENROUTER_DATA_COLLECTION || 'deny')
  });
  await ad.identify({ system: 's', instruction: 'i', schema: {} });
  return captured;
}
ok('retention filters are on when nothing is set',
  (await providerBlockFor({})).zdr === true);
ok('an empty value does not silently disable them',
  (await providerBlockFor({ OPENROUTER_ZDR: '' })).zdr === true);
ok('only an explicit zero turns retention filtering off',
  (await providerBlockFor({ OPENROUTER_ZDR: '0' })).zdr === false);
ok('data collection can be widened deliberately',
  (await providerBlockFor({ OPENROUTER_DATA_COLLECTION: 'allow' })).data_collection === 'allow');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
