/* Serving the app from the same Worker as the API.
 *
 * One origin means no CORS to configure, no endpoint to wire up by hand, and one
 * deploy. The client learns where the API is by being told, once, in the page it
 * was served from — rather than by a constant someone has to remember to edit.
 *
 * Written as a plain string transform rather than HTMLRewriter so the dev server
 * and the Worker run the identical code, and so it can be tested without a
 * Workers runtime.
 */

/* An explicit sentinel, not the variable name: the app *reads*
   window.KLASER_AI_ENDPOINT, so matching on the name alone made every page look
   already-configured and the injection silently never happened. */
const MARKER = '/*klaser:endpoint*/';

/* Same-origin injects the expression `location.origin` rather than a string, for
   two reasons: an empty string is falsy and the client treats a falsy endpoint as
   "no service configured", and evaluating it in the browser keeps the preview
   deployment, production and localhost all working from the same build with no
   hostname baked in anywhere. */
export function injectConfig(html, endpoint = '') {
  if (html.includes(MARKER)) return html;          /* already configured, leave it */
  const value = endpoint ? JSON.stringify(endpoint) : 'location.origin';
  const tag = `<script>${MARKER}window.KLASER_AI_ENDPOINT = ${value};</script>\n`;
  const at = html.indexOf('<script>');
  if (at === -1) return html;
  return html.slice(0, at) + tag + html.slice(at);
}

export function isHtmlPath(pathname) {
  return pathname === '/' || pathname === '/index.html' || pathname.endsWith('.html');
}

/* env.ASSETS is the Workers static-assets binding; `read` is the dev-server
   equivalent. Both return a Response, so the caller does not care which it got. */
export async function serveAsset(req, { assets, endpoint = '' }) {
  if (!assets) return null;
  const res = await assets.fetch(req);
  if (!res || res.status === 404) return res;

  const url = new URL(req.url);
  if (!isHtmlPath(url.pathname)) return res;

  const html = await res.text();
  return new Response(injectConfig(html, endpoint), {
    status: res.status,
    headers: { ...Object.fromEntries(res.headers), 'content-type': 'text/html; charset=utf-8' }
  });
}
