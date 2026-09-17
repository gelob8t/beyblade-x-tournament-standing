# Part images

Drop part photos in this folder and the **Collection → Browse catalog** picker
(plus your Collection list, and the hover-to-preview popup) will show them
instead of the generated icon.

## Naming

Files must be named after the part's **slug** — lowercase, spaces and
punctuation turned into `-`. A few examples:

| Part name | File name |
| --- | --- |
| Dran Sword | `dran-sword.webp` |
| 3-60 | `3-60.webp` |
| M (Metal) variants | `m-metal-variants.webp` |

Get the full list any time with:

```bash
npm run parts:slugs
```

## Format

- **WebP**, square-ish, roughly **300–350px** on the longest edge — that
  covers everywhere it's shown, including the hover preview at 240px on a
  retina screen. WebP compresses these product photos dramatically better
  than PNG/JPG (typically **8–15x smaller** at the same visual quality —
  most of what keeps the catalog loading fast) while still supporting a
  transparent background, which looks best against the dark theme.
- Got a PNG/JPG source? Load it in any browser tab and run in the console:
  ```js
  const img = new Image(); img.src = "your-file.png";
  await img.decode();
  const c = document.createElement("canvas");
  const s = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = img.naturalWidth * s; c.height = img.naturalHeight * s;
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  c.toBlob((b) => open(URL.createObjectURL(b)), "image/webp", 0.82); // right-click > Save as
  ```
- Nothing is required — add as many or as few as you like. Any part without
  a matching file (or a bad/missing image) just falls back to its generated
  icon automatically.

## Wiring

`data/parts.json` already points here:

```json
"imageBase": "./assets/parts/",
"imageExt": ".webp"
```

Change `imageExt` if you'd rather use `.png`/`.jpg`/etc. (bigger files —
not recommended), or set an explicit `"image"` URL on a single entry in
`data/parts.json` to override just that one part (e.g. to point at an
external host instead).

**Keep the file's real format matching its extension.** A `.webp`-content
file saved as `.png` (or vice versa) usually still renders — browsers sniff
actual content — but GitHub Pages serves `Content-Type` from the extension,
so it's a real mismatch, not just a naming nicety.

Only add images you have the right to use — see the note in the main
[README](../../README.md#2c-optional-part-images).
