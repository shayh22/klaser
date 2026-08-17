/* Hebrew system prompts.
 *
 * Both prompts are written in Hebrew on purpose. The documents are Hebrew, the
 * catalogue is Hebrew, and the answer is Hebrew keys — an English instruction layer
 * in the middle is one translation step nobody needs.
 *
 * The catalogue block is identical on every request and goes first, so it can carry
 * cache_control. Everything that varies goes after it.
 */

export function identifySystem() {
  return `אתה מזהה מסמכים רשמיים ישראליים. משימתך היחידה היא לקבוע מה המסמך הזה — לא לקרוא אותו לעומק.

החזר:
- is_letter: האם זו התכתבות רשמית מרשות (מכתב, טופס, הודעה, דרישה, אישור). צילום סלפי, קבלה מחנות, תמונה מטושטשת שאי אפשר לקרוא — false.
- agency: מפתח הרשות מתוך הקטלוג, או null.
- form_code: קוד הטופס או המכתב המודפס על הדף (למשל בל/250, טופס 101, מספר מכתב מחלקתי). זהו המזהה הזול והאמין ביותר. null אם אין.
- form_title_he: כותרת המסמך בעברית, מילה במילה כפי שמופיעה.
- personalised: true אם זו התכתבות אישית על מקרה ספציפי (פקיד שכותב על מצב אישי), false אם זה טופס או מכתב תבניתי שנשלח לרבים.

אל תנחש. null עדיף על ניחוש.`;
}

export function readSystem() {
  return `אתה קורא מכתבים וטפסים רשמיים ישראליים ומחלץ מהם רשימת מסמכים שהאדם צריך לאסוף.

כללי ברזל:

1. **החזר מפתחות מהקטלוג, לא טקסט חופשי.** agency, template ו-required_docs חייבים להיות מפתחות שמופיעים בקטלוג שקיבלת. אסור להמציא מפתח.

2. **לכל מסמך ברשימה צרף evidence** — הציטוט בעברית מתוך המכתב שממנו הבנת שצריך אותו, מילה במילה. אם אינך יכול לצטט, אל תוסיף את המסמך.

3. **מסמך שנדרש ואין לו מפתח בקטלוג** — הכנס ל-extra_docs עם השם בעברית בדיוק כפי שהמכתב כותב אותו. אל תתרגם ואל תשייך בכוח למפתח דומה.

4. **תאריכים.** אם המכתב אומר "תוך 30 יום", חשב מול letter_date. אם letter_date לא קריא — deadline הוא null. אל תמציא תאריך.

5. **אסמכתא.** העתק תו-תו. מספר תיק שגוי גרוע ממספר תיק חסר.

6. **form_to_fill** — האם יש טופס שהאדם צריך למלא ולהגיש?
   - where: "self" אם הטופס נמצא במסמך הזה עצמו (מכתב עם ספח למילוי, טופס להדפסה).
   - where: "separate" אם המכתב מפנה לטופס אחר שצריך להשיג בנפרד.
   - where: "none" אם אין מה למלא.

7. **confidence.** היה כן. מכתב מקומט שצולם בחושך ראוי לציון נמוך. ציון נמוך אינו כישלון — הוא המידע שמונע מהמערכת להוסיף פריטים שגויים לתיק של מישהו.

זכור למי זה מיועד: עולים חדשים ואנשים שמתקשים עם בירוקרטיה. פריט שגוי ברשימה שולח אותם לדלפק הלא נכון עם הניירת הלא נכונה. חסר עדיף על שגוי.`;
}

/* The catalogue block. Sent verbatim on every request, first, so it caches. */
export function catalogueBlock(catalogue) {
  return `להלן הקטלוג. כל תשובה חייבת להשתמש במפתחות שמופיעים כאן בלבד.\n\n${JSON.stringify(catalogue, null, 1)}`;
}

/* Built at boot from the catalogue, so adding a document to index.html widens what
   the model may answer without anyone editing a schema. */
export function analysisSchema(catalogue) {
  const agencyKeys = Object.keys(catalogue.agencies);
  const docKeys = Object.keys(catalogue.docs);
  const tplKeys = Object.keys(catalogue.templates);

  return {
    type: 'object',
    additionalProperties: false,
    required: ['agency', 'template', 'required_docs', 'extra_docs', 'deadline',
               'letter_date', 'reference', 'form_code', 'form_title_he',
               'form_to_fill', 'personalised', 'confidence', 'language'],
    properties: {
      agency:        { type: ['string', 'null'], enum: [...agencyKeys, null] },
      agency_child:  { type: ['string', 'null'] },
      template:      { type: ['string', 'null'], enum: [...tplKeys, null] },
      required_docs: {
        type: 'array', maxItems: 20,
        items: {
          type: 'object', additionalProperties: false,
          required: ['key', 'evidence', 'confidence'],
          properties: {
            key:        { type: 'string', enum: docKeys },
            evidence:   { type: 'string', maxLength: 200 },
            confidence: { type: 'number', minimum: 0, maximum: 1 }
          }
        }
      },
      extra_docs: {
        type: 'array', maxItems: 10,
        items: {
          type: 'object', additionalProperties: false,
          required: ['he', 'evidence', 'confidence'],
          properties: {
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
  required: ['is_letter', 'agency', 'form_code', 'form_title_he', 'personalised'],
  properties: {
    is_letter:     { type: 'boolean' },
    agency:        { type: ['string', 'null'] },
    form_code:     { type: ['string', 'null'], maxLength: 40 },
    form_title_he: { type: ['string', 'null'], maxLength: 120 },
    personalised:  { type: 'boolean' }
  }
};
