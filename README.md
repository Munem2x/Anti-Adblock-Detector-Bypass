# Anti-Adblock Detector Bypass

A Tampermonkey userscript that neutralises common anti-adblock detectors so a
page can't tell that your blocker is running. It works by making the evidence
detectors look for appear normal, and by stopping the detector libraries from
reporting a hit.

> This does **not** unblock ads. It hides the *detection* of your blocker, so
> adblock walls and "please disable your adblocker" overlays don't appear.
> Supporting sites by allowing non-intrusive ads is still the better option.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open `Anti-Adblock-Detector-Bypass.user.js` (raw view) — Tampermonkey offers
   to install it — or create a new script and paste the file contents.
3. Hard-refresh the target site (Ctrl+F5). If a detection flag was stored
   earlier, clear the site's cookies / localStorage or use a private window.

## What it does

- **Native-looking API patches** — patched functions report a normal
  (`toString` looks native) result so `Function.prototype.toString` checks and
  proxy-trap checks don't give the script away.
- **Fake network success** — `fetch` and `XMLHttpRequest` calls to ad URLs
  (doubleclick, googlesyndication, adsafeprotected, `ads.js`, `/ad/`, …) get a
  synthetic `200`. XHRs replay the full `readyState` 1→4 sequence, which
  detectors such as the Fab/NoAdBlock HTTP plugin require.
- **Detector-library stubs** — `FuckAdBlock`, `BlockAdBlock`, `SniffAdBlock`,
  `NoAdBlock`/`noAdBlock` (Fab), and `AaDetector` are replaced with a fake
  detector whose `onDetected` is a no-op and whose `onNotDetected` fires.
- **Bait geometry spoofing** — elements whose class/id looks like ad bait get
  non-zero `offsetHeight/offsetWidth/offsetLeft/offsetTop`,
  `clientHeight/clientWidth`, a `getBoundingClientRect()`, a non-null
  `offsetParent`, and `getComputedStyle(...).getPropertyValue('display'|
  'visibility')` returning `block`/`visible`. Benign elements are untouched.
- **Wall / overlay removal** — fixed, full-screen elements whose text matches
  wall keywords (`adblock`, `disable your adblock`, `whitelist`, `redirect me`,
  …) are removed, with a body-wipe guard so a detector can't blank the page.
- **Detector storage purge** — known detection flags in cookies and
  `localStorage` are cleared.

## Configure target sites

By default the script runs everywhere. To limit it, edit `CONFIG.hosts`:

```js
hosts: [],                       // every site
hosts: ['earnbitmoon.club'],     // one site
hosts: ['*.example.org'],        // subdomain wildcard
```

## Detectors / sites it handles

- **Fab / NoAdBlock** (`/static/js/noadblock.js`) — used by the earn-* faucet
  family such as `earnbitmoon.club` and `tm-earn.com`. Counters: library stub,
  bait geometry (including `offsetLeft`/`offsetTop`), and the HTTP plugin's
  readyState 1–4 requirement.
- **BlockAdBlock / FuckAdBlock / SniffAdBlock** — stubbed constructors and
  instances.
- **AAB** (`assets/antiadblock.js`) — body-wipe guard plus overlay removal.
- Generic bait classes (`ad-banner`, `adsbox`, `pub_300x250`, `text-ad`, …) and
  generic keyword walls.

Detection is an arms race. If a site still gets through, open the console with
`?adb_debug` in the URL to see what the script logged, and report the site.

## License

MIT — see [LICENSE](LICENSE).
