# WP Sanitize

A clean, fully client-side editor for WordPress PHP-serialized data.

WordPress stores a lot of data as PHP-serialized blobs (`wp_options.option_value`, `wp_postmeta.meta_value`, transients, widget settings). Editing those blobs by hand is painful because the string byte counts — `s:5:"hello"` — break the moment you change the contents. WP Sanitize decodes serialized blobs into editable JSON, lets you modify values, and re-encodes back to a byte-perfect serialized string.

- **No server.** Everything runs in the browser. Nothing is uploaded.
- **No tracking.** No analytics, no external calls after the page loads.
- **UTF-8 safe.** Byte counts are computed with `TextEncoder`, not `String.length`.
- **BigInt aware.** PHP ints above `2^53` round-trip via BigInt without precision loss.
- **Round-trip fidelity.** `serialize(unserialize(x)) === x` byte-for-byte on real WP blobs.

---

## Develop

```bash
npm install
npm run dev        # starts Vite dev server on http://localhost:5173
npm test           # run the serialize/unserialize/bridge test suite
npm run build      # type-check + production build into ./dist
npm run preview    # serve ./dist locally
```

## Project layout

```
src/
  types.ts          PhpValue discriminated union + PhpSerializeError
  unserialize.ts    byte-cursor parser for PHP serialized strings
  serialize.ts      emitter (writes byte-accurate s:N:"..." prefixes)
  bridge.ts         PhpValue ↔ plain JSON, with sentinels for edge cases
  examples.ts       sample blobs for the "Load example" menu
  main.ts           UI wiring (CodeMirror panes, buttons, status line)
  styles.css
test/               Vitest unit + round-trip tests
public/
  CNAME             custom domain for GitHub Pages
  favicon.svg
.github/workflows/
  deploy.yml        build + deploy to Pages on push to main
```

## JSON bridge

When you decode, PHP values map to JSON like this:

| PHP                    | JSON                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `null`                 | `null`                                                       |
| `true` / `false`       | `true` / `false`                                             |
| `int` within 2^53      | number                                                       |
| `int` beyond 2^53      | `{ "__bigint__": "..." }`                                    |
| `float`                | number (or `{ "__float__": "NaN" }` for NaN/±Infinity)       |
| `string`               | string                                                       |
| array (sequential int) | `[ ... ]`                                                    |
| array (other)          | `{ "key": ... }` (plus `"__order__": [...]` if needed)       |
| `object`               | `{ "__class__": "Name", ...props }`                          |
| internal reference     | `{ "__ref__": N }` or `{ "__ref_object__": N }`              |

Sentinels (`__class__`, `__bigint__`, `__order__`, `__ref__`) are restored on encode. JavaScript object literals reorder integer-like keys numerically ahead of string keys — `__order__` is emitted only when the PHP array's original order would be corrupted by that normalization.

## Deploy to GitHub Pages with a custom domain

1. Push this repo to GitHub.
2. Repo → **Settings → Pages → Source = GitHub Actions**.
3. Edit [public/CNAME](public/CNAME) to your domain (currently `sanitize.wp.ke`).
4. DNS: add a `CNAME` record pointing `sanitize` → `<your-github-username>.github.io`. For an apex domain, use A records to GitHub's four IPs (see GitHub Pages docs).
5. Push to `main` — the workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs tests, builds, and deploys. Once DNS propagates, flip on **Enforce HTTPS** under Settings → Pages.

`base: '/'` is correct in [vite.config.ts](vite.config.ts) because the site is served at the root of a custom domain. If you ever serve it at `<user>.github.io/wp-sanitize/` instead, change `base` to `'/wp-sanitize/'`.

## Limitations (v1)

- Internal references (`r:` / `R:`) round-trip but aren't ergonomic to edit.
- Float precision follows JavaScript's `Number.toString` — differs from PHP's `serialize_precision` in the long tail.
- Private/protected object properties (the NUL-byte-prefixed key form) parse as strings verbatim; they'll look odd in the JSON view.

## License

MIT
