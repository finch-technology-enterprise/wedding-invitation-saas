# Assets

Drop files at the exact paths below and they appear automatically. No
layout or code changes are needed — every slot already reserves its
final size and aspect ratio, so the composition does not move when a
photograph arrives.

Paths and aspect ratios are configured in `public/js/content.js`
(`wedding.photos` and `wedding.music`).

## Photography — `public/assets/photos/`

| File            | Aspect ratio  | Where it appears                          |
| --------------- | ------------- | ----------------------------------------- |
| `hero.jpg`      | 825 × 1000 (portrait, ~0.83) | Cover — full-bleed, the first thing seen |
| `portrait.jpg`  | 666 × 1000 (tall portrait, ~0.67) | Portrait scene, flanked by vertical names |
| `story.jpg`     | 1 × 1 (square) | Story scene — displayed as a circle |
| `landscape.jpg` | 1418 × 1000 (landscape, ~1.42) | Full-bleed wide moment between text scenes |
| `venue.jpg`     | 1110 × 1000 (~1.11) | Venue scene |
| `closing.jpg`   | 1 × 1 (square) | Reserved; not currently placed in a scene |

**Guidance**

- Supply roughly 2× the displayed size for crisp rendering on retina
  screens. At a 390px canvas the hero displays at 390 × 473 CSS px, so
  around 800 × 970 is ample.
- `.webp` is preferred; `.jpg`, `.png` and `.avif` also work. If you
  change the extension, update the path in `content.js`.
- Crop to the ratio in the table. Anything else is centre-cropped to
  fill, so off-ratio images lose their edges.
- Until a file exists the slot renders a neutral tonal placeholder and
  the server answers `204 No Content` — there are no broken-image icons
  and no 404s in the console.

## Music — `public/assets/audio/`

| File        | Notes                                        |
| ----------- | -------------------------------------------- |
| `theme.m4a` | Background track. `.mp3` also works — update `wedding.music.src`. |

- Autoplay is attempted on load. Browsers usually block it, in which
  case the control shows its muted state and the first tap starts
  playback. The cinematic timeline runs either way.
- When a track is present, the invitation's scroll duration
  automatically retimes to the length of the audio so the two finish
  together. Without a track it runs for the default 72 seconds.
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
