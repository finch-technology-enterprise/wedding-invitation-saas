/**
 * Chinese webfont loading.
 *
 * Google serves CJK families as ~100 unicode-range subsets and the browser
 * fetches every subset any glyph on the page falls into — around 25 requests
 * for this invitation. Passing `text=` returns one small subset containing
 * exactly the glyphs asked for, which brings that down to two.
 *
 * The glyph list is derived from the live content at runtime rather than
 * hardcoded, so editing copy in content.js can never silently leave a
 * character without a face.
 */

/** Collect every distinct non-Latin glyph reachable in an object tree. */
function collectGlyphs(value, into) {
  if (typeof value === "string") {
    for (const ch of value) if (ch.codePointAt(0) > 0x2000) into.add(ch);
  } else if (Array.isArray(value)) {
    for (const v of value) collectGlyphs(v, into);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectGlyphs(v, into);
  }
}

export function loadChineseFonts(wedding) {
  const glyphs = new Set();
  collectGlyphs(wedding.copy, glyphs);
  collectGlyphs(wedding.couple, glyphs);
  collectGlyphs(wedding.venue, glyphs);
  collectGlyphs(wedding.date, glyphs);
  collectGlyphs(wedding.music, glyphs);

  // Characters the renderer generates rather than reading from config:
  // weekday names, calendar and countdown labels, separators.
  for (const ch of "年月日星期一二三四五六农历天时分秒　·（）＋－…") glyphs.add(ch);

  const body = [...glyphs].sort().join("");
  // The couple's names are the only text set in the calligraphic face.
  const script = [wedding.couple.groom.zh, wedding.couple.bride.zh, "&"].join("");

  const add = (href) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    // Font files are fetched cross-origin from fonts.gstatic.com. Without
    // this the request is made in CORS mode with no matching credentials
    // mode and the browser rejects the response.
    link.crossOrigin = "anonymous";
    link.href = href;
    document.head.append(link);
  };

  const base = "https://fonts.googleapis.com/css2";
  add(`${base}?family=Noto+Serif+SC:wght@400&text=${encodeURIComponent(body)}&display=swap`);
  add(`${base}?family=Ma+Shan+Zheng&text=${encodeURIComponent(script)}&display=swap`);
}
