/* Where Playwright lives, decided at run time rather than baked in.
 *
 * Every browser suite used to import it from an absolute path inside the container
 * these tests were first written in. That path does not exist on a CI runner, so
 * all twenty browser suites crashed there — and a crash reports zero assertions,
 * which reads on the summary line almost exactly like a suite that has nothing to
 * say. The browser half of the suite was effectively not running in CI at all.
 *
 * Normal resolution first, so an installed copy wins; the container path second,
 * so working here still needs no install.
 */
let chromium;

try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
  } catch {
    try {
      ({ chromium } = await import('playwright-core'));
    } catch {
      console.error('Playwright not found. Install it with:  npm i --no-save playwright');
      process.exit(2);
    }
  }
}

export { chromium };
