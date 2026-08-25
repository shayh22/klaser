/* Hebrew system prompts.
 *
 * Both prompts are written in Hebrew on purpose. The documents are Hebrew, the
 * catalogue is Hebrew, and the answer is Hebrew — an English instruction layer in
 * the middle is one translation step nobody needs.
 *
 * The catalogue block is identical on every request and goes first, so it can carry
 * cache_control. Everything that varies — including a user's own vocabulary — goes
 * after it, so adding to your own list never costs you the cache.
 *
 * The catalogue is a hint, not a filter. It used to be a closed vocabulary: the
 * model could answer only in keys that appeared in it, and anything else was thrown
 * away. That made a hallucinated document name impossible, and it also made קרנית
 * impossible, and a private landlord, and a bank nobody had listed yet. Since the
 * whole point is helping people through bureaucracy nobody has enumerated for them,
 * the vocabulary is now open: name the key when one fits, and write the Hebrew as
 * the letter writes it when none does.
 *
 * What stops an invented document is not the list. It is rule 2 — a document that
 * cannot be quoted from the letter does not go on the list at all.
 */

export function identifySystem() {
  return `אתה מזהה מסמכים רשמיים ישראליים. משימתך היחידה היא לקבוע מה המסמך הזה — לא לקרוא אותו לעומק.

החזר:
- is_letter: האם זו התכתבות רשמית מגוף כלשהו — רשות, חברה, קרן, בנק, קופת חולים, ועד בית, בעל דירה. מכתב, טופס, הודעה, דרישה, אישור, חשבון. צילום סלפי, קבלה מחנות, תמונה מטושטשת שאי אפשר לקרוא — false.
- agency: מפתח הגוף מתוך הרשימה שקיבלת, אם אחד מהם באמת מתאים. אם לא — null.
- agency_he: שם הגוף בעברית, מילה במילה כפי שהוא מופיע על המסמך. תמיד מלא את זה, גם כשמילאת גם agency.
- form_code: קוד הטופס או המכתב המודפס על הדף (למשל בל/250, טופס 101, מספר מכתב מחלקתי). זהו המזהה הזול והאמין ביותר. null אם אין.
- form_title_he: כותרת המסמך בעברית, מילה במילה כפי שמופיעה.
- personalised: true אם זו התכתבות אישית על מקרה ספציפי, false אם זה טופס או מכתב תבניתי שנשלח לרבים.

אל תנחש מפתח. שם בעברית עדיף על מפתח שגוי.`;
}

export function readSystem() {
  return `אתה קורא מכתבים, טפסים וחשבונות רשמיים ישראליים ומחלץ מהם את רשימת המסמכים שהאדם צריך לאסוף.

כללי ברזל:

1. **הרשימה שקיבלת היא עזר, לא גבול.** אם מסמך או גוף מופיע ברשימה — החזר את המפתח שלו, כי אז האפליקציה יודעת להציג אותו בארבע שפות. אם אינו מופיע — זו אינה בעיה: החזר key ריק (null) ואת השם בעברית. **אל תשייך בכוח למפתח דומה.** "אישור על גובה קצבה" אינו "אישור ניהול חשבון". מפתח שגוי גרוע ממפתח חסר.

2. **לכל מסמך צרף evidence** — הציטוט בעברית מתוך המסמך שממנו הבנת שצריך אותו, מילה במילה. **אם אינך יכול לצטט — אל תוסיף את המסמך.** זה הכלל היחיד שמפריד בין רשימה שנקראה מהמכתב לבין רשימה שנוחשה מהנושא. טופס תביעה ריק שכתוב בו "מסמכים מצורפים" ואחריו שורות ריקות אינו רשימה — הוא מקום שבו האדם ימלא רשימה. אל תמציא לו תוכן.

3. **לכל מסמך מלא he** — השם בעברית, כפי שהמסמך קורא לו. גם כשמילאת key. אם המסמך משתמש בשם שונה מזה שברשימה, כתוב את מה שהמסמך כותב.

4. **תאריכים.** אם המכתב אומר "תוך 30 יום", חשב מול letter_date. אם letter_date לא קריא — deadline הוא null. אל תמציא תאריך.

5. **אסמכתא.** העתק תו-תו. מספר תיק שגוי גרוע ממספר תיק חסר.

6. **form_to_fill** — האם יש טופס שהאדם צריך למלא ולהגיש?
   - where: "self" אם הטופס נמצא במסמך הזה עצמו (מכתב עם ספח למילוי, טופס להדפסה).
   - where: "separate" אם המכתב מפנה לטופס אחר שצריך להשיג בנפרד.
   - where: "none" אם אין מה למלא.

7. **confidence.** היה כן. מכתב מקומט שצולם בחושך ראוי לציון נמוך. ציון נמוך אינו כישלון — הוא המידע שמונע מהמערכת להוסיף פריטים שגויים לתיק של מישהו.

זכור למי זה מיועד: עולים חדשים ואנשים שמתקשים עם בירוקרטיה. פריט שגוי ברשימה שולח אותם לדלפק הלא נכון עם הניירת הלא נכונה. חסר עדיף על שגוי.`;
}

/* The shared catalogue. Byte-identical on every request, which is what lets it
   carry the cache breakpoint. */
export function catalogueBlock(catalogue) {
  return `להלן רשימת העזר המשותפת — גופים, מסמכים ותהליכים מוכרים.
היא עוזרת לך לזהות דברים נפוצים, והיא אינה מגבילה אותך: מסמך או גוף שאינו כאן הוא לגיטימי לחלוטין, פשוט החזר את שמו בעברית.

${JSON.stringify(catalogue, null, 1)}`;
}

/* A user's own agencies and documents, sent after the shared block so the shared
   one still caches. Someone who added their landlord, their kupa's branch or a fund
   nobody listed gets it recognised by name on the next letter rather than re-typed.
   Their own words, sent with their own document, and never stored here. */
export function extrasBlock(extras) {
  if (!extras || (!extras.agencies?.length && !extras.docs?.length)) return '';
  const lines = ['בנוסף, המשתמש הזה הוסיף לעצמו את השמות הבאים. הם באותו מעמד בדיוק כמו הרשימה המשותפת:'];
  if (extras.agencies?.length) {
    lines.push('\nגופים:');
    for (const a of extras.agencies) lines.push(`- ${a.key}: ${a.he}`);
  }
  if (extras.docs?.length) {
    lines.push('\nמסמכים:');
    for (const d of extras.docs) lines.push(`- ${d.key}: ${d.he}`);
  }
  return lines.join('\n');
}

/* Built per request from the catalogue plus whatever the user has added, so a name
   somebody saved last week is a key the model may answer with today. */
export function analysisSchema(catalogue, extras) {
  const agencyKeys = [...Object.keys(catalogue.agencies), ...(extras?.agencies || []).map(a => a.key)];
  const docKeys    = [...Object.keys(catalogue.docs),     ...(extras?.docs || []).map(d => d.key)];
  const tplKeys    = Object.keys(catalogue.templates);

  return {
    type: 'object',
    additionalProperties: false,
    required: ['agency', 'agency_he', 'template', 'required_docs', 'deadline',
               'letter_date', 'reference', 'form_code', 'form_title_he',
               'form_to_fill', 'personalised', 'confidence', 'language'],
    properties: {
      /* Still an enum, so the model cannot invent a *key* — a key it made up would
         translate to nothing in three of the four languages. null is the honest
         answer when nothing fits, and agency_he carries the name instead. */
      agency:        { type: ['string', 'null'], enum: [...agencyKeys, null] },
      agency_he:     { type: ['string', 'null'], maxLength: 80 },
      agency_child:  { type: ['string', 'null'] },
      template:      { type: ['string', 'null'], enum: [...tplKeys, null] },
      required_docs: {
        type: 'array', maxItems: 25,
        items: {
          type: 'object', additionalProperties: false,
          required: ['key', 'he', 'evidence', 'confidence'],
          properties: {
            key:        { type: ['string', 'null'], enum: [...docKeys, null] },
            /* The name as the letter writes it. Required, because it is what makes
               a document without a key usable rather than discarded. */
            he:         { type: 'string', maxLength: 80 },
            evidence:   { type: 'string', maxLength: 200 },
            confidence: { type: 'number', minimum: 0, maximum: 1 }
          }
        }
      },
      deadline:       { type: ['string', 'null'] },
      letter_date:    { type: ['string', 'null'] },
      reference:      { type: ['string', 'null'], maxLength: 60 },
      form_code:      { type: ['string', 'null'], maxLength: 40 },
      form_title_he:  { type: ['string', 'null'], maxLength: 120 },
      form_to_fill: {
        type: 'object', additionalProperties: false,
        required: ['where'],
        properties: {
          where:         { type: 'string', enum: ['self', 'separate', 'none'] },
          form_code:     { type: ['string', 'null'], maxLength: 40 },
          form_title_he: { type: ['string', 'null'], maxLength: 120 }
        }
      },
      personalised: { type: 'boolean' },
      confidence:   { type: 'number', minimum: 0, maximum: 1 },
      language:     { type: 'string', enum: ['he', 'en', 'fr', 'ru', 'ar', 'other'] }
    }
  };
}

export const IDENTIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_letter', 'agency', 'agency_he', 'form_code', 'form_title_he', 'personalised'],
  properties: {
    is_letter:     { type: 'boolean' },
    agency:        { type: ['string', 'null'] },
    agency_he:     { type: ['string', 'null'], maxLength: 80 },
    form_code:     { type: ['string', 'null'], maxLength: 40 },
    form_title_he: { type: ['string', 'null'], maxLength: 120 },
    personalised:  { type: 'boolean' }
  }
};
