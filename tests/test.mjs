import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const ROOT = new URL('..', import.meta.url).pathname;
async function newCase(page){
  // the toolbar button is hidden while the list is empty; the empty card owns the action
  if(await page.isVisible('#emptyNew')) await page.click('#emptyNew');
  else await page.click('#newCase');
}

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type()==='error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('file://' + ROOT + 'index.html');
await page.waitForTimeout(300);

const ok = (label, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);

// 1. Boots in Hebrew RTL
ok('boots RTL/he', await page.getAttribute('html','dir') === 'rtl' && await page.getAttribute('html','lang') === 'he');
ok('title rendered', (await page.textContent('h1')).includes('קלסר'));
ok('empty state shown', (await page.textContent('#caseList')).includes('עדיין אין תיקים'));

// 2. Create a case from a template
await newCase(page);
await page.selectOption('#fTemplate','license');
await page.waitForTimeout(100);
ok('template sets agency', await page.inputValue('#fAgency') === 'tachbura');
ok('template sets title', (await page.inputValue('#fTitle')).length > 0);
await page.fill('#fRef','ABC-123');
// 4 days out from whenever this runs — a fixed date silently rots into a
// different day count and fails for no reason
const due4 = new Date(Date.now() + 4*86400000).toISOString().slice(0,10);
await page.fill('#fDeadline', due4);          // -> "due" badge
await page.click('#saveCase');
await page.waitForTimeout(150);
ok('case created', (await page.$$('.case')).length === 1);
ok('4 template docs', (await page.$$('.doc')).length === 4);
ok('deadline badge', (await page.textContent('#caseList')).includes('עוד 4 ימים'));
ok('stats count', (await page.textContent('#stats')).includes('4'));

// 3. Tick a document -> progress + missing-docs stat update
await page.click('.doc input');
await page.waitForTimeout(150);
ok('doc ticked persists', await page.isChecked('.doc input'));
ok('missing docs now 3', (await page.textContent('#stats')).includes('3'));

// 4. Add a custom doc and a note
await page.fill('[data-act="newdoc"]','מסמך משלי');
await page.click('[data-act="adddoc"]');
await page.waitForTimeout(120);
ok('custom doc added', (await page.$$('.doc')).length === 5);
await page.fill('[data-act="newnote"]','התקשרתי, אמרו לחכות');
await page.click('[data-act="addnote"]');
await page.waitForTimeout(120);
ok('note added', (await page.textContent('.notes')).includes('התקשרתי'));

// 5. Language switch -> LTR + Hebrew chips appear
await page.click('[data-lang="fr"]');
await page.waitForTimeout(200);
ok('switches to LTR', await page.getAttribute('html','dir') === 'ltr');
ok('french UI', (await page.textContent('nav.tabs')).includes('Mes dossiers'));
ok('hebrew chip visible in FR', (await page.$$('.he-term')).length > 0);
ok('he term is the agency', (await page.textContent('#caseList')).includes('משרד התחבורה'));
ok('custom doc text survives', (await page.textContent('#caseList')).includes('מסמך משלי'));

// 6. Persistence across reload
await page.reload();
await page.waitForTimeout(300);
ok('lang persisted', await page.getAttribute('html','lang') === 'fr');
ok('case persisted', (await page.$$('.case')).length === 1);
ok('ref persisted', (await page.textContent('#caseList')).includes('ABC-123'));

// 7. Agencies + glossary tabs
await page.click('[data-tab="agencies"]');
await page.waitForTimeout(150);
ok('agencies listed', (await page.$$('.dir-item')).length >= 8);
await page.click('[data-tab="glossary"]');
await page.waitForTimeout(150);
const gAll = (await page.$$('.gterm')).length;
await page.fill('#glossSearch','תור');
await page.waitForTimeout(150);
ok('glossary search filters', (await page.$$('.gterm')).length < gAll);
await page.fill('#glossSearch','appeal');
await page.waitForTimeout(150);
ok('glossary searches EN too', (await page.textContent('#glossList')).includes('ערעור'));

// 8. Russian sanity
await page.click('[data-lang="ru"]');
await page.waitForTimeout(150);
ok('russian UI', (await page.textContent('nav.tabs')).includes('Мои дела'));

// 9. Overdue badge
await page.click('[data-tab="cases"]');
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('klaser.v1'));
  d.cases[0].deadline = '2020-01-01';
  localStorage.setItem('klaser.v1', JSON.stringify(d));
});
await page.reload();
await page.waitForTimeout(250);
ok('overdue badge', (await page.textContent('#caseList')).includes('Просрочено'));

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNo console/page errors.');
await browser.close();
