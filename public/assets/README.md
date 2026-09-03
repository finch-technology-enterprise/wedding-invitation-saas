# Assets

Every slot already reserves its final size and aspect ratio, so the
composition does not move when a photograph arrives.

**Two steps per asset:**

1. save the file at the path below
2. flip `ready: false` → `ready: true` for that slot in
   `public/js/content.js`

The `ready` flag is what stops the browser requesting files that do not
exist yet: while it is false the slot renders its placeholder and makes
no network request at all, so an incomplete asset set produces no 404s
and no console errors for visitors.

## Photography — `public/assets/photos/`

| File            | Aspect ratio | Where it appears |
| --------------- | ------------ | ---------------- |
| `hero.jpg`      | tall portrait, ~0.83 | Cover — fills the whole opening screen, with the title laid over it. The most important image. |
| `portrait.jpg`  | tall portrait, ~0.67 | Portrait scene, flanked by vertical names |
| `story.jpg`     | square | Story scene — displayed as a circle |
| `landscape.jpg` | landscape, ~1.42 | Full-bleed wide moment between text scenes |
| `venue.jpg`     | ~1.11 | Venue scene |
| `closing.jpg`   | square | Closing scene — sits behind the final words |

The cover and closing photographs sit under text, so prefer frames with
calmer areas at the top (cover) and centre (closing). Both are covered
by a soft white scrim, so a slightly busy image still reads.

**Guidance**

- Supply roughly 2× the displayed size for crisp rendering on retina
  screens. At a 390px canvas the hero fills 390 × 844 CSS px, so around
  1000 × 2000 is ample.
- `.webp` is preferred; `.jpg`, `.png` and `.avif` also work. If you
  change the extension, update the path in `content.js`.
- Crop to the ratio in the table. Anything else is centre-cropped to
  fill, so off-ratio images lose their edges.
- Until a file exists the slot renders a neutral tonal placeholder and
  the server answers `204 No Content` — there are no broken-image icons
  and no 404s in the console.

## Music — `public/assets/audio/`

| File        | Notes |
| ----------- | ----- |
| `theme.m4a` | Background track. `.mp3` also works — update `wedding.music.src`. Remember to set `ready: true`. |

- Autoplay is attempted on load. Browsers usually block it, in which
  case the control shows its muted state and the first tap starts
  playback. The cinematic timeline runs either way.
- When a track is present the invitation retimes to its length so the
  two finish together. Without one, the canvas advances at a fixed
  ~46 px/s — the rate at which the reference's copy stays readable —
  which is about 91 seconds end to end at a 390px viewport.
- Use music you have the right to publish. Do not commit a copyrighted
  track.

## Ornaments — `public/assets/ornaments/`

Currently unused. All decorative elements (the 囍 seal, hairline rules,
diamonds, calendar hearts) are drawn in CSS/SVG, so there is nothing to
license or download. Use this directory only if a bespoke ornament is
commissioned later.

## Fonts — `public/assets/fonts/`

Currently unused. Typefaces load from Google Fonts:

- **Noto Serif SC** — Chinese editorial body text
- **Cinzel** — Latin display (dates, captions)
- **Ma Shan Zheng** — calligraphic accent for the couple's names

Self-host here only if you need to remove the Google Fonts dependency;
subset to the glyphs actually used, since full CJK faces are large.
