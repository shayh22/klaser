# Backlog

Things that are decided-to-be-deferred, not forgotten. Each entry carries enough
research that picking it up later does not mean redoing the work.

---

## B-1 · Government symbols in the share image, and the disclaimer

**Status:** deferred · **Raised:** Aug 2026 · **Blocks:** nothing · **Legal exposure:** low but real

`docs/og-image.jpg` — the WhatsApp/Open Graph preview card — shows the ביטוח לאומי
and רשות המסים logos, דואר ישראל, the Knesset, the Israeli flag, and the state
emblem (the menorah).

### What the law actually says

**חוק הדגל, הסמל והמנון המדינה, תש"ט-1949, סעיף 3** — no person may manufacture an
object bearing סמל המדינה, nor use it in any way, except under a licence or written
permit from שר הפנים. The section reads as absolute.

But the body that administers it, **ועדת הסמל והדגל** at משרד הפנים, publishes
guiding principles that state:

> ככל שמדובר בשימוש בסמל המדינה, **בין השאר** לצורכי תיעוד, לימוד, עבודה מחקרית
> ודווחים היסטוריים, באופן שאינו מטעה את הציבור לחשוב שמדובר ספרות רשמית הנעשית
> במסגרת המדינה או מטעמה — אין מניעה לעשות שימוש בסמל המדינה.

"בין השאר" makes the list illustrative, and the operative condition is a
*misleading* test. Promotional use is still outside the named categories, so the
emblem is the one item where relying on interpretation is weakest.

**The flag is not restricted.** סעיף 3 covers the emblem only; the flag is protected
against desecration, not against use. The flag can stay.

**חוק הגנת סמלים, תשל"ה-1974, סעיף 5** — the provision that actually governs the
agency logos:

> לא ישתמש אדם בכל שם, או בכל סמל או דגל, **אף אם אין עליהם צו הגנה**, למטרות
> מסחר, פרסומת או הסברה, בדרך שיש בה כדי להביא את הזולת לחשוב שאותו אדם פועל מטעם
> המדינה, רשות מרשויותיה או רשות מקומית, או שיש בה כדי לפגוע בתקנת הציבור או ברגשותיו.

No permit requirement at all — the only question is the impression created. The same
law provides a certainty route: a three-member committee appointed by שר הפנים can
issue a **תעודה** confirming that a specific use does not create that impression.

Separately, agency logos are registered marks and copyrighted works — a different
track from both statutes.

### Why the preview image is the sharp case and the app is not

Inside the app the symbols sit beside agency names, official links and Klaser's own
branding; context does most of the work. The preview card is the one place the
artwork travels **stripped of all context**, in a feed, with no disclaimer anywhere
near it. So any disclaimer has to be **rendered into the image itself**.

### What to do when this comes off the backlog

1. Bake a strip into the image: `שירות פרטי · אינו אתר ממשלתי`. Make the Klaser mark
   dominant over any official logo.
2. Remove the menorah from the image. Keep the flag.
3. Add a persistent, visible four-language disclaimer in the app — header area, not
   buried in a modal. Wording deliberately negates the statutory element
   (`פועל מטעם המדינה, רשות מרשויותיה`) rather than saying a vague "unofficial":

   | | |
   |---|---|
   | **he** | שירות פרטי. אינו אתר ממשלתי ואינו פועל מטעם המדינה או מטעם רשות כלשהי. |
   | **fr** | Service privé. Ce n'est pas un site gouvernemental et il n'agit pas au nom de l'État ni d'aucune administration. |
   | **en** | A private service. Not a government website, and not acting on behalf of the State or any authority. |
   | **ru** | Частный сервис. Это не государственный сайт и он не действует от имени государства или какого-либо ведомства. |

4. Optional, for certainty: apply for a תעודה under חוק הגנת סמלים, or a כתב היתר
   from ועדת הסמל והדגל if the emblem is to be kept.

### Gaps in this research

gov.il, nevo, Wikipedia and WIPO Lex were all blocked by the session's egress proxy,
so the statutes are quoted from search-result excerpts rather than read end to end,
and the committee's full principles document and application procedure were not
retrieved. The committee page is at
<https://www.gov.il/he/departments/policies/flag-emblem-committee>. Not legal advice;
worth an hour with an Israeli IP lawyer before the service is monetised.

---

## B-2 · MIT licence versus a paid service

**Status:** deferred · **Blocks:** the paid tier, eventually

`LICENSE` still grants everyone the right to copy, modify and sell Klaser. That was
survivable for a static file whose value was the content. It is a different
proposition once a hosted, metered service is attached. Options: keep MIT for the
client and licence the service separately; relicense the client (AGPL, or
source-available); or split the repo.

---

## B-3 · Header video weight

**Status:** deferred · **Blocks:** nothing

`docs/gemini_generated_video_2d79698b.mp4` is 2.42MB and loads with
`preload="auto"` on every visit, including mobile data. Re-export at 600–800KB, or
switch to `preload="metadata"` with the poster carrying the first paint.

---

## B-4 · Unverified gov.il department slugs

**Status:** deferred · **Blocks:** nothing

Six `gov.il` department URLs in `AGENCIES` could not be verified — gov.il is blocked
from this environment. They need one pass from a machine with normal network access.
