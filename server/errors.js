/* One error envelope for the whole service. `message_he` is shown to the user as
   written — the client does not translate error text at launch, and never surfaces a
   raw upstream message. */

export const CODES = {
  bad_request:            { status: 400, he: 'הבקשה לא תקינה. נסו שוב.' },
  image_too_large:        { status: 413, he: 'התמונה גדולה מדי. צלמו שוב או בחרו תמונה קטנה יותר.' },
  unsupported_media_type: { status: 400, he: 'סוג הקובץ אינו נתמך. אפשר JPEG, PNG או PDF.' },
  invalid_token:          { status: 401, he: 'החיבור פג. רעננו את הדף ונסו שוב.' },
  consent_missing:        { status: 400, he: 'צריך לאשר את שליחת המסמך לפני הניתוח.' },
  quota_exhausted:        { status: 429, he: 'נגמרו הקרדיטים לחודש הזה. הקלסר ממשיך לעבוד כרגיל — רק הניתוח האוטומטי מושהה.' },
  rate_limited:           { status: 429, he: 'יותר מדי בקשות. המתינו רגע ונסו שוב.' },
  service_degraded:       { status: 503, he: 'הניתוח האוטומטי מושבת כרגע. הקלסר עצמו עובד רגיל.' },
  upstream_error:         { status: 503, he: 'הניתוח לא זמין כרגע. נסו שוב בעוד כמה דקות.' },
  internal:               { status: 500, he: 'משהו השתבש. נסו שוב.' }
};

export class ApiError extends Error {
  constructor(code, { retryAfter = null, detail = '', cause = null } = {}) {
    super(code + (detail ? `: ${detail}` : ''));
    this.code = CODES[code] ? code : 'internal';
    this.retryAfter = retryAfter;
    /* Kept for logs and for tools/probe-live.mjs. It never reaches the client —
       errorResponse() sends only the code and message_he — but when the upstream
       rejects a request, its own words are the only thing that says which field
       was wrong. Dropping them makes the failure undiagnosable. */
    this.cause = cause;
    this.upstreamBody = cause && cause.body ? cause.body : null;
    this.upstreamStatus = cause && cause.status ? cause.status : null;
  }
}

export function errorResponse(err) {
  const code = err instanceof ApiError ? err.code : 'internal';
  const spec = CODES[code];
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (err.retryAfter) headers['retry-after'] = String(err.retryAfter);
  return new Response(JSON.stringify({
    error: { code, message_he: spec.he, retry_after: err.retryAfter ?? null }
  }), { status: spec.status, headers });
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra }
  });
}
