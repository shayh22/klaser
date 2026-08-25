# פריסה מהטלפון — בלי מחשב, בלי טרמינל

הכול מתבצע בדפדפן. Cloudflare בונה את הקוד מ־GitHub בעצמה, אז אין צורך ב־wrangler
ואין צורך במחשב.

---

## שלב 0 · מפתח OpenRouter — 5 דקות

1. <https://openrouter.ai> → התחבר.
2. **Credits** → הוסף קרדיט. ~$5 מספיקים בשפע (כ־$0.03 למכתב).
3. **Keys** → **Create Key**. שם: `klaser`. קבע **credit limit על המפתח עצמו** כאן,
   לפני היצירה — לא אחריה.
4. **העתק אותו עכשיו** — הוא מוצג פעם אחת. שמור בפתקים/מנהל סיסמאות בטלפון.

הוא נראה כמו `sk-or-v1-…`.

> אפשר גם מפתח Anthropic ישיר (`sk-ant-…`) מ־console.anthropic.com — השרת בוחר לפי
> המפתח שקיים, בלי הגדרה נוספת. הפירוט ב־`docs/API-KEY.md`.

---

## שלב 1 · חיבור הריפו ל־Cloudflare — 5 דקות

1. <https://dash.cloudflare.com> → מצד שמאל **Workers & Pages**
2. **Create** → לשונית **Workers** → **Import a repository**
   (קישור ישיר: <https://dash.cloudflare.com/?to=/:account/workers-and-pages/create>)
3. **Connect GitHub** → אשר גישה ל־`shayh22/klaser`
4. הגדרות הבנייה:

   | שדה | ערך |
   |---|---|
   | Repository | `shayh22/klaser` |
   | Branch | `main` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |

   > אם השם `klaser` כבר תפוס אצלך — שנה את `name` בראש `wrangler.toml`
   > מהדפדפן ב־GitHub, כי פריסה על שם קיים **דורסת** אותו.

5. **Save and Deploy**. הבנייה לוקחת דקה־שתיים.

בסוף תקבל כתובת: `https://klaser.<something>.workers.dev`

**פתח אותה בטלפון — האפליקציה כבר עובדת שם.** בשלב הזה הניתוח עדיין על מוק
(תשובה קבועה), כי עוד לא הוספנו מפתח.

---

## שלב 2 · הכנסת המפתח — 2 דקות

1. באותו Worker → **Settings** → **Variables and Secrets**
2. **Add** → סוג **Secret**
3. שם: `OPENROUTER_API_KEY` · ערך: המפתח מהשלב 0
   (או `ANTHROPIC_API_KEY`, אם בחרת מפתח ישיר)
4. **Deploy** / **Save**

**זהו.** רענן את הכתובת בטלפון, צלם מכתב אמיתי, ולחץ "סריקת מכתב" — עכשיו מודל
אמיתי קורא אותו.

איך יודעים שזה עבר למודל האמיתי: פתח `https://<הכתובת>/v1/health` — השדה
`provider` יהיה `openrouter` (או `anthropic`) במקום `mock`.

> אם הסריקה מחזירה שגיאה, ה־Worker כותב את סיבת הדחייה ללוג ולא לדפדפן —
> **Workers & Pages → klaser → Logs**, ושם כתוב איזה שדה נדחה. זה מכוון: הדפדפן
> מקבל קוד והודעה בעברית בלבד, לעולם לא את התשובה של הספק.
>
> שגיאה אחת שווה להכיר מראש: **"no allowed providers"**. זו לא בעיה במפתח — כל
> בקשה יוצאת עם דרישה שהמכתב לא יישמר ולא ישמש לאימון אצל אף ספק, ולפעמים לדגם
> מסוים אין ספק שעומד בזה. הפתרון הוא להחליף דגם, לא לוותר על הדרישה.
> הפירוט ב־`docs/API-KEY.md`.

---

## שלב 3 · מסד נתונים לקרדיטים — 5 דקות, אפשר לדחות

בלי זה השירות עובד, אבל מונה הקרדיטים יושב בזיכרון ומתאפס בכל הפעלה מחדש של
ה־Worker. לבדיקות זה בסדר גמור. למשתמשים אמיתיים — לא.

1. בתפריט הצד: **Storage & Databases** → **D1** → **Create**
2. שם: `klaser` → Create
3. העתק את ה־**Database ID** שמוצג
4. ב־GitHub, ערוך את `wrangler.toml` מהדפדפן
   (<https://github.com/shayh22/klaser/edit/main/wrangler.toml>) — הסר את סימני
   ההערה מארבע השורות של `[[d1_databases]]` והדבק את ה־ID
5. Commit → Cloudflare בונה מחדש לבד
6. חזור ל־D1 → הטבלה `klaser` → לשונית **Console**, והדבק:

```sql
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0,
  credit_limit INTEGER NOT NULL, resets_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spend (
  day TEXT PRIMARY KEY, usd REAL NOT NULL DEFAULT 0);
```

---

## אם משהו נשבר

**הבנייה נכשלה** — ב־Cloudflare, ה־Worker → **Deployments** → הפריסה האחרונה →
**Build logs**. שלח לי את השורות האחרונות.

**הדף עולה אבל "סריקת מכתב" נכשל** — פתח `https://<הכתובת>/v1/health`. אם
`accepts_analysis` הוא `false`, ה־`reason` אומר למה (`spend_cap` / `kill_switch` /
`upstream`).

**לוגים חיים** — ה־Worker → **Logs** → **Begin log stream**, ואז נסה בטלפון. כל
ניתוח כותב שורה אחת עם מודל, טוקנים, עלות וזמן. **אף פעם לא תוכן של מסמך.**

---

## מה זה עולה

| | |
|---|---|
| Cloudflare Workers | חינם עד 100,000 בקשות ביום |
| D1 | חינם בהיקף הזה |
| Anthropic | ~$0.03 למכתב |

תקרת ההוצאה היומית ב־`wrangler.toml` היא $25 כברירת מחדל. מעליה השירות מפסיק
לקבל עבודה, והאפליקציה ממשיכה לעבוד מקומית כרגיל.

**כיבוי חירום:** Settings → Variables → הוסף משתנה `KILL_SWITCH` בערך `1`.
הניתוח נכבה, האפליקציה נשארת חיה.
