/* What the Anthropic adapter actually puts on the wire.
 *
 * No key and no network are involved: fetch is replaced, and the request body is
 * asserted directly. This does not prove the API accepts it — only a real call
 * does that — but it catches the shape mistakes that the mock adapter cannot,
 * because the mock never sees a request at all.
 */
import { createAnthropicAdapter } from '../server/adapters/anthropic.js';
import { createAnalyzer } from '../server/analyze.js';
import { readFileSync } from 'node:fs';

const catalogue = JSON.parse(readFileSync(new URL('../contracts/catalogue.json', import.meta.url).pathname, 'utf8'));
let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

const sent = [];
const fakeFetch = async (url, opts) => {
  sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
  return {
    ok: true,
    json: async () => ({
      model: sent[sent.length - 1].body.model,
      content: [{ type: 'text', text: JSON.stringify(
        sent.length === 1
          ? { is_letter: true, agency: 'btl', form_code: 'בל/5020', form_title_he: 'בקשה לקצבת ילדים', personalised: false }
          : { agency: 'btl', agency_child: null, template: 'child_allowance',
              required_docs: [{ key: 'teudat_zehut', evidence: 'צילום תעודת זהות', confidence: 0.9 }],
              extra_docs: [], deadline: null, letter_date: null, reference: null,
              form_code: 'בל/5020', form_title_he: 'בקשה לקצבת ילדים',
              form_to_fill: { where: 'self', form_code: null, form_title_he: null },
              personalised: false, confidence: 0.9, language: 'he' }) }],
      usage: { input_tokens: 3000, output_tokens: 400, cache_read_input_tokens: 1500 }
    })
  };
};

const adapter = createAnthropicAdapter({ apiKey: 'test-key', fetchImpl: fakeFetch });
const analyze = createAnalyzer({ adapter, catalogue });

/* ---- an image ---- */
const out = await analyze({ image: 'AAAA', mediaType: 'image/jpeg' });
ok('two calls: identify then read', sent.length === 2);

const [ident, read] = sent;
ok('identify uses Haiku', ident.body.model === 'claude-haiku-4-5');
ok('read uses Sonnet 5', read.body.model === 'claude-sonnet-5');
ok('api version header set', ident.headers['anthropic-version'] === '2023-06-01');
ok('key is sent as x-api-key', ident.headers['x-api-key'] === 'test-key');

ok('an image goes in an image block', read.body.messages[0].content[0].type === 'image');
ok('image source is base64', read.body.messages[0].content[0].source.type === 'base64');
ok('instruction follows the image', read.body.messages[0].content[1].type === 'text');

ok('system is a block array', Array.isArray(read.body.system));
ok('catalogue is the cached block', !!read.body.system[1].cache_control);
ok('the prompt itself is not cached', !read.body.system[0].cache_control);
ok('the cached block is the catalogue', read.body.system[1].text.includes('"agencies"'));

const fmt = read.body.output_config.format;
ok('structured output requested', fmt.type === 'json_schema');
ok('schema enums come from the catalogue',
  fmt.schema.properties.agency.enum.includes('btl') && fmt.schema.properties.agency.enum.includes(null));
ok('doc keys are constrained to the catalogue',
  fmt.schema.properties.required_docs.items.properties.key.enum.length === Object.keys(catalogue.docs).length);
ok('the model cannot invent an agency', !fmt.schema.properties.agency.enum.includes('made_up'));
ok('max_tokens leaves room for the answer', read.body.max_tokens >= 2000);

ok('the result came back parsed', out.result.template === 'child_allowance');
ok('a read is charged one credit', out.credits === 1);
ok('cost is accounted', out.costUsd > 0);

/* ---- a PDF: the shape the mock could never have caught ---- */
sent.length = 0;
await analyze({ image: 'AAAA', mediaType: 'application/pdf' });
const pdfBlock = sent[1].body.messages[0].content[0];
ok('a PDF goes in a document block, not an image block', pdfBlock.type === 'document');
ok('PDF media type is preserved', pdfBlock.source.media_type === 'application/pdf');
ok('PDF is still base64', pdfBlock.source.type === 'base64');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
