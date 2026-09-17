# Part images

Drop part photos in this folder and the **Collection → Browse catalog** picker
(plus your Collection list) will show them instead of the generated icon.

## Naming

Files must be named after the part's **slug** — lowercase, spaces and
punctuation turned into `-`. A few examples:

| Part name | File name |
| --- | --- |
| Dran Sword | `dran-sword.png` |
| 3-60 | `3-60.png` |
| M (Metal) variants | `m-metal-variants.png` |

Get the full list any time with:

```bash
npm run parts:slugs
```

## Format

- **PNG**, square-ish, roughly **200–400px**. Bigger is wasted bandwidth for
  a small catalog thumbnail; a transparent background looks best against the
  dark theme.
- Nothing is required — add as many or as few as you like. Any part without
  a matching file (or a bad/missing image) just falls back to its generated
  icon automatically.

## Wiring

`data/parts.json` already points here:

```json
"imageBase": "./assets/parts/",
"imageExt": ".png"
```

Change `imageExt` if you're using `.jpg`/`.webp`/etc., or set an explicit
`"image"` URL on a single entry in `data/parts.json` to override just that
one part (e.g. to point at an external host instead).

Only add images you have the right to use — see the note in the main
[README](../../README.md#2c-optional-part-images).
