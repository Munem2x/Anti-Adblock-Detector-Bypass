// ==UserScript==
// @name         Anti-Adblock Detector Bypass
// @namespace    https://github.com/Max
// @version      2.0.4
// @icon         https://raw.githubusercontent.com/Munem2x/Anti-Adblock-Detector-Bypass/main/icon.svg
// @updateURL    https://raw.githubusercontent.com/Munem2x/Anti-Adblock-Detector-Bypass/main/Anti-Adblock-Detector-Bypass.user.js
// @downloadURL https://raw.githubusercontent.com/Munem2x/Anti-Adblock-Detector-Bypass/main/Anti-Adblock-Detector-Bypass.user.js
// @description  Neutralises common anti-adblock detectors: native-looking API patches, fake network success for ad URLs, detector-library stubs, bait-element geometry spoofing, keyword wall removal and detector-storage cleanup. Add target hosts in CONFIG.hosts.
// @author       Max
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  if (window.__adbBypassInstalled) return;
  window.__adbBypassInstalled = true;

  const CONFIG = {
    // Host substrings this script is allowed to touch. Empty = every site.
    // Narrow it, e.g. ['example.com', '*.example.org'] — broad mode can break pages.
    hosts: [],
    debug: new URLSearchParams(location.search).has('adb_debug'),
    neutralizeGlobals: true,
    stubLibraries: true,
    spoofNetwork: true,
    spoofBait: true,
    removeOverlays: true,
    neutralizeTimers: true,
    clearDetectorStorage: true,
    hideInsteadOfDelete: false,
    // Some detectors (AAB) read window.AAB_CONFIG and never fire if the
    // thresholds are unreachable. Harmless on sites that do not use it.
    neutralizeDetectorConfig: true,
    extraAdHosts: [],
    sweepIntervalMs: 2000,
    maxSweeps: 10,
    // Site-specific inline-script rewrites, applied only where the browser
    // supports the Firefox-only `beforescriptexecute` event:
    //   inlineRules: [ [ /checkAdBlock\(\)/, 'false' ] ],
    inlineRules: [],
  };

  const LOG = (...args) => {
    if (CONFIG.debug) console.log('%c[ADB-Bypass]', 'color:#0a0;font-weight:bold', ...args);
  };

  // ---------------------------------------------------------------- hosts
  function hostAllowed() {
    if (!CONFIG.hosts.length) return true;
    const h = location.hostname;
    return CONFIG.hosts.some((pattern) => {
      if (pattern.startsWith('*.')) {
        const bare = pattern.slice(2);
        return h === bare || h.endsWith('.' + bare);
      }
      if (pattern.includes('*')) {
        const re = new RegExp(
          '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
        );
        return re.test(h);
      }
      return h === pattern || h.endsWith('.' + pattern);
    });
  }

  if (!hostAllowed()) return;

  const on = (k) => CONFIG[k];

  // ------------------------------------------- make patches look native
  const realToString = Function.prototype.toString;
  const masks = new WeakMap();
  const mask = (fake, real) => { try { masks.set(fake, real); } catch (_) {} return fake; };
  try {
    const ts = new Proxy(realToString, {
      apply(t, self, args) {
        return Reflect.apply(t, masks.has(self) ? masks.get(self) : self, args);
      },
    });
    masks.set(ts, realToString);
    Object.defineProperty(Function.prototype, 'toString', {
      configurable: true, writable: true, value: ts,
    });
  } catch (_) { /* ignore */ }

  // ------------------------------------------------- ad URL classification
  const AD_HOST_RE = new RegExp(
    '(^|\\.)(' + [
      'doubleclick\\.net', 'googlesyndication\\.com', 'googleadservices\\.com',
      'googletagservices\\.com', 'googletagmanager\\.com', 'google-analytics\\.com',
      'adservice\\.google\\.[a-z.]+', 'amazon-adsystem\\.com', 'adnxs\\.com',
      'taboola\\.com', 'outbrain\\.com', 'criteo\\.(com|net)', 'pubmatic\\.com',
      'rubiconproject\\.com', 'openx\\.net', 'media\\.net', 'mgid\\.com',
      'revcontent\\.com', 'adform\\.net', 'popads\\.net', 'popcash\\.net',
      'propellerads\\.com', 'exoclick\\.com', 'adsterra\\.com', 'juicyads\\.com',
      'adskeeper\\.(com|co\\.uk)', 'hilltopads\\.(net|com)', 'a-ads\\.com',
      'clickadu\\.com', 'trafficjunky\\.(net|com)', 'adcash\\.com', 'onclickads\\.net',
      'highperformanceformat\\.com', 'highrevenueformat\\.com',
      'profitableratecpmnetwork\\.com', 'profitablecpmrate\\.com', 'effectivegatecpmrate\\.com',
      'monetag\\.com', 'yllix\\.com', 'adsco\\.re', 'ad-maven\\.com',
      'adblockanalytics\\.com', 'scorecardresearch\\.com',
      // anti-adblock / ad-recovery providers
      'html-load\\.com', 'content-loader\\.com', 'getadmiral\\.com', 'ads\\.adthrive\\.com',
      'cadmus\\.script\\.ac', 'btloader\\.com', 'ab\\.dns-finder\\.com',
      'cdn\\.privacy-mgmt\\.com', 'imasdk\\.googleapis\\.com',
    ].join('|') + ')$',
    'i'
  );
  const AD_PATH_RE = /\/(?:ads?|adv|adverts?|advertisement|banners?|pagead\d*|prebid|show_ads|adsbygoogle|fuckadblock|blockadblock|ad[-_]?(?:frame|banner|block|test|script|loader|manager|serve|server|sense))(?:[/._?-]|$)/i;

  function parseUrl(u) {
    try {
      const url = new URL(String(u), location.href);
      return /^https?:$/.test(url.protocol) ? url : null;
    } catch (_) { return null; }
  }
  function isAdHost(u) {
    const url = parseUrl(u);
    if (!url) return false;
    const h = url.hostname.toLowerCase();
    return AD_HOST_RE.test(h) ||
      CONFIG.extraAdHosts.some((d) => h === d || h.endsWith('.' + d));
  }
  function isAdUrl(u) {
    const url = parseUrl(u);
    if (!url) return false;
    return isAdHost(url.href) || AD_PATH_RE.test(url.pathname);
  }

  // ------------------------------------------------------- global stubs
  const BOOL_FALSE = [
    'adBlockDetected', 'adblockDetector', 'adBlockEnabled', 'blockDetect',
    'adblockUser', 'adBlocker', 'adbDetected', 'detectedAdBlock', 'adblock',
    'blockerDetected', 'adBlockDetectedByUser',
  ];
  const BOOL_TRUE = [
    'canCheckAds', 'iHaveLoadedAds', 'niceAdsCheck', 'adsLoaded', 'adLoaded',
    'canRunAdvertisement', 'adBlockAllowed',
  ];
  const NOOP_FUNCS = [
    'detectAdBlock', 'detectAdblock', 'checkAdBlock', 'checkAdblock',
    'showAdBlockMessage', 'showAdBlockNotice', 'blockAdblockUser',
    'openPopUpForBreakPage', 'adBlockerDetected', 'detectAdBlocker',
    'adbDetect', 'onAdBlockDetected', 'showAdblockMessage',
  ];
  // Detectors that expose a promise-based global; answer "no adblock".
  const PROMISE_FALSE_FUNCS = ['detectAdblock'];

  function defineGlobal(name, value) {
    try {
      Object.defineProperty(window, name, {
        configurable: true, enumerable: true,
        get() { return value; },
        set() { /* swallow: detectors try to flip these */ },
      });
    } catch (_) {
      try { window[name] = value; } catch (__) { /* ignore */ }
    }
  }

  // Detector constructor fake: `.on(false, fn)` fires the "no adblock" callback.
  function makeDetector() {
    function Detector() { this._fns = []; this._fired = false; }
    const fire = (self) => {
      const fns = self._fns.slice();
      setTimeout(() => fns.forEach((f) => { try { f(); } catch (_) {} }), 1);
    };
    Detector.prototype.setOption = function () { return this; };
    Detector.prototype.check = function () { fire(this); return false; };
    Detector.prototype.emitEvent = function () { return this; };
    Detector.prototype.clearEvent = function () { this._fns = []; };
    Detector.prototype.on = function (detected, fn) {
      if (!detected && typeof fn === 'function') {
        this._fns.push(fn);
        if (!this._fired) { this._fired = true; const s = this; setTimeout(() => fire(s), 50); }
      }
      return this;
    };
    Detector.prototype.onDetected = function () { return this; };
    Detector.prototype.onNotDetected = function (fn) { return this.on(false, fn); };
    return Detector;
  }

  function lock(name, fakeValue) {
    let stored;
    try {
      Object.defineProperty(window, name, {
        configurable: false, enumerable: false,
        get() { return on('stubLibraries') ? fakeValue : stored; },
        set(v) { stored = v; },
      });
    } catch (_) { /* already non-configurable */ }
  }

  function installGlobalStubs() {
    if (CONFIG.neutralizeGlobals) {
      BOOL_FALSE.forEach((n) => defineGlobal(n, false));
      BOOL_TRUE.forEach((n) => defineGlobal(n, true));
      NOOP_FUNCS.forEach((n) => defineGlobal(n, () => false));
      PROMISE_FALSE_FUNCS.forEach((n) => defineGlobal(n, () => Promise.resolve(false)));
    }
    if (CONFIG.stubLibraries) {
      for (const n of ['FuckAdBlock', 'BlockAdBlock', 'SniffAdBlock', 'NoAdBlock', 'NoAdblock', 'AaDetector']) {
        const D = makeDetector();
        lock(n, D);
        lock(n.charAt(0).toLowerCase() + n.slice(1), new D());
      }
      lock('canRunAds', true);
      lock('isAdBlockActive', false);
      try {
        const stub = [];
        stub.loaded = true;
        stub.push = function () { return 0; };
        let real;
        Object.defineProperty(window, 'adsbygoogle', {
          configurable: true,
          get() { return real !== undefined ? real : (on('stubLibraries') ? stub : undefined); },
          set(v) { real = v; },
        });
      } catch (_) { /* ignore */ }
    }
    LOG('global stubs installed');
  }

  // ------------------------------------------------- network failure spoof
  const AD_SIG = 'adsbygoogle googletag googletagservices googlesyndication doubleclick adsense adcontainer';
  const AD_CHUNK = '/* ' + AD_SIG + ' */var aabx=' + 'x'.repeat(64) + ';';

  // Build a synthetic response that survives size/signature checks: a real
  // 'basic'/'cors' response cannot be forged, so shadow `type`/`url` with own
  // properties and give it a plausible content-length and body.
  function fakeAdResponse(url, init) {
    const mode = (init && init.mode) || 'cors';
    const noCors = mode === 'no-cors';
    let size;
    if (url.indexOf('googlesyndication') !== -1) size = 40 * 1024;
    else if (url.indexOf('gpt.js') !== -1) size = 55 * 1024;
    else {
      let h = 0;
      for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
      size = (40 + (h % 30)) * 1024;
    }
    let body = '';
    while (body.length < size) body += AD_CHUNK;
    body = body.slice(0, size);
    let r;
    try {
      r = new Response(body, {
        status: 200, statusText: 'OK',
        headers: { 'content-length': String(size), 'content-type': 'application/javascript' },
      });
    } catch (_) {
      r = new Response('', { status: 200, statusText: 'OK' });
    }
    try { Object.defineProperty(r, 'type', { value: noCors ? 'opaque' : 'cors', configurable: true }); } catch (_) {}
    try { Object.defineProperty(r, 'url', { value: noCors ? '' : url, configurable: true }); } catch (_) {}
    return r;
  }

  function spoofNetwork() {
    const realFetch = window.fetch;
    if (typeof realFetch === 'function') {
      window.fetch = mask(function fetch(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        const p = Reflect.apply(realFetch, this, arguments);
        if (!on('spoofNetwork') || !isAdUrl(url)) return p;
        return p.catch(() => {
          LOG('spoofed fetch', url);
          return fakeAdResponse(url, init);
        });
      }, realFetch);
    }

    try {
      const realOpen = XMLHttpRequest.prototype.open;
      const realSend = XMLHttpRequest.prototype.send;
      const xhrUrls = new WeakMap();
      XMLHttpRequest.prototype.open = mask(function open(method, url) {
        try { xhrUrls.set(this, String(url)); } catch (_) {}
        return Reflect.apply(realOpen, this, arguments);
      }, realOpen);
      XMLHttpRequest.prototype.send = mask(function send() {
        const url = xhrUrls.get(this);
        if (url && on('spoofNetwork') && isAdUrl(url)) {
          const x = this;
          LOG('spoofed xhr', url);
          // Simulate the full readyState sequence 1->4 so detectors that track
          // each state (e.g. the Fab/NoAdBlock HTTP plugin) see a real load.
          [1, 2, 3, 4].forEach((rs, idx) => {
            setTimeout(() => {
              const def = (k, v) => {
                try { Object.defineProperty(x, k, { configurable: true, get() { return v; } }); } catch (_) {}
              };
              def('readyState', rs);
              def('status', rs === 4 ? 200 : 0);
              def('statusText', rs === 4 ? 'OK' : '');
              if (rs === 4) {
                def('responseText', ''); def('response', ''); def('responseURL', url);
              }
              x.dispatchEvent(new Event('readystatechange'));
              if (rs === 4) {
                x.dispatchEvent(new ProgressEvent('load'));
                x.dispatchEvent(new ProgressEvent('loadend'));
              }
            }, 10 + idx * 15);
          });
          return;
        }
        return Reflect.apply(realSend, this, arguments);
      }, realSend);
    } catch (_) { /* ignore */ }

    // Resource load errors for ad URLs: swallow the error, fire a fake load.
    const handledEvents = new WeakSet();
    function swallowError(e) {
      if (!on('spoofNetwork') || handledEvents.has(e)) return;
      const t = e.target;
      if (!t || t === window || !t.tagName) return;
      const url = t.src || t.href || '';
      if (!isAdUrl(url)) return;
      handledEvents.add(e);
      e.stopImmediatePropagation();
      LOG('spoofed resource error', t.tagName, url);
      setTimeout(() => { try { t.dispatchEvent(new Event('load')); } catch (_) {} }, 0);
    }
    document.addEventListener('error', swallowError, true);
  }

  // Some detectors expose their tuning through a global config object.
  function neutralizeDetectorConfig() {
    if (!CONFIG.neutralizeDetectorConfig) return;
    try {
      const prev = window.AAB_CONFIG || {};
      window.AAB_CONFIG = Object.assign({}, prev, { minBlockScore: 1e9, minStrong: 1e9 });
    } catch (_) {}
  }

  // ------------------------------------------------- body-wipe prevention
  // Aggressive detectors (e.g. AAB) clear document.body before showing their
  // wall. Block the clear so the page content survives even if a probe fires.
  function preventBodyWipe() {
    const detectorPresent = () =>
      typeof window.detectAdblock === 'function' ||
      !!document.getElementById('__aab_overlay__') ||
      !!document.querySelector('script[src*="antiadblock"]');

    const origRC = Element.prototype.replaceChildren;
    if (typeof origRC === 'function') {
      Element.prototype.replaceChildren = mask(function (...nodes) {
        if (this === document.body && nodes.length === 0 && detectorPresent()) {
          LOG('blocked body wipe (replaceChildren)');
          return;
        }
        return Reflect.apply(origRC, this, arguments);
      }, origRC);
    }
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (desc && desc.set) {
      const origSet = desc.set;
      Object.defineProperty(Element.prototype, 'innerHTML', Object.assign({}, desc, {
        set(v) {
          if (this === document.body && (v === '' || v == null) && detectorPresent()) {
            LOG('blocked body wipe (innerHTML)');
            return;
          }
          return origSet.call(this, v);
        },
      }));
    }
  }

  // ------------------------------------------------------- geometry spoof
  const BAIT_RE = /(?:^|[\s_-])(?:ads?|adv|adverts?|advertisement|adsbox|adsbygoogle|adbox|adsense|ad-?banner|ad-?block|adhere|banner|sponsor|pub)/i;

  function isBait(el) {
    if (!el || el.nodeType !== 1) return false;
    let cls = '';
    try {
      cls = (typeof el.className === 'string' ? el.className : '') ||
        (el.getAttribute && el.getAttribute('class')) || '';
    } catch (_) { cls = ''; }
    if (!BAIT_RE.test(cls + ' ' + (el.id || ''))) return false;
    try {
      return el.children.length < 3 && (el.textContent || '').trim().length < 40;
    } catch (_) { return false; }
  }

  function spoofBaitGeometry() {
    const sizeProps = [
      ['offsetHeight', HTMLElement.prototype],
      ['offsetWidth', HTMLElement.prototype],
      ['offsetLeft', HTMLElement.prototype],
      ['offsetTop', HTMLElement.prototype],
      ['clientHeight', Element.prototype],
      ['clientWidth', Element.prototype],
    ];
    for (const [prop, proto] of sizeProps) {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.get) continue;
      const realGet = d.get;
      Object.defineProperty(proto, prop, Object.assign({}, d, {
        get: mask(function () {
          const v = realGet.call(this);
          return (v === 0 || v === null) && isBait(this) ? 10 : v;
        }, realGet),
      }));
    }
    const dParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    if (dParent && dParent.get) {
      const realGet = dParent.get;
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', Object.assign({}, dParent, {
        get: mask(function () {
          const v = realGet.call(this);
          return v === null && isBait(this) ? document.body : v;
        }, realGet),
      }));
    }
    const realRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = mask(function getBoundingClientRect() {
      const r = Reflect.apply(realRect, this, arguments);
      if (r.width === 0 && r.height === 0 && isBait(this)) {
        try { return new DOMRect(r.x, r.y, 10, 10); }
        catch (_) { return { x: r.x, y: r.y, left: r.left, top: r.top, width: 10, height: 10, right: r.left + 10, bottom: r.top + 10 }; }
      }
      return r;
    }, realRect);

    const realGCS = window.getComputedStyle;
    window.getComputedStyle = mask(function getComputedStyle(el) {
      const st = Reflect.apply(realGCS, window, arguments);
      if (!isBait(el)) return st;
      const fix = (prop, v) => {
        if (prop === 'display' && v === 'none') return 'block';
        if (prop === 'visibility' && v === 'hidden') return 'visible';
        if ((prop === 'height' || prop === 'width') && v === '0px') return '10px';
        if (prop === 'opacity' && v === '0') return '1';
        return v;
      };
      return new Proxy(st, {
        get(t, p) {
          if (p === 'getPropertyValue') return (n) => fix(String(n), t.getPropertyValue(n));
          const v = Reflect.get(t, p, t);
          if (typeof v === 'function') return v.bind(t);
          return typeof p === 'string' ? fix(p, v) : v;
        },
      });
    }, realGCS);
    try { window.getComputedStyle.__adbOriginal = realGCS; } catch (_) {}
    LOG('geometry spoofing installed');
  }

  // -------------------------------------------------------- overlay removal
  const OVERLAY_SEL = [
    '[class*="adblock" i]', '[id*="adblock" i]', '[class*="ad-block" i]', '[id*="ad-block" i]',
    '[class*="blocker" i]', '[id*="blocker" i]', '[class*="whitelist" i]', '[id*="whitelist" i]',
    '[class*="pleasedisable" i]', '[id*="pleasedisable" i]', '[class*="adb-overlay" i]', '[id*="adb-overlay" i]',
    '[class*="overlay" i]', '[id*="overlay" i]', '[class*="backdrop" i]', '[id*="backdrop" i]',
    '[class*="modal" i]', '[id*="modal" i]',
  ].join(',');
  const KEYWORD_RE = /adblock|ad blocker|ad-block|adblocker|disable your (ad|ads|blocker)|disable (your|the) adblock|turn off|whitelist|please disable|allow ads|ads are paying|redirect me|adblock detected|desative|desactiv|bloque|controle de anúncios/i;

  let observer = null;
  let sweepTimer = null;
  let sweepCount = 0;
  let bodySnapshot = '';

  function snapshotBody() {
    try {
      if (document.body && document.body.innerHTML.length > bodySnapshot.length) {
        bodySnapshot = document.body.innerHTML;
      }
    } catch (_) {}
  }
  function restoreBodyIfEmpty() {
    try {
      if (document.body && document.body.children.length === 0 && bodySnapshot) {
        document.body.innerHTML = bodySnapshot;
        LOG('restored body from snapshot');
      }
    } catch (_) {}
  }

  function realGCS(el) {
    const orig = window.getComputedStyle && window.getComputedStyle.__adbOriginal;
    return orig ? orig.call(window, el) : window.getComputedStyle.call(window, el);
  }

  function restorePage() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      try {
        el.style.setProperty('overflow', 'auto', 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
        el.style.setProperty('pointer-events', 'auto', 'important');
        el.style.setProperty('user-select', 'auto', 'important');
      } catch (_) {}
    }
    try {
      if (document.body && realGCS(document.body).position === 'fixed') {
        document.body.style.setProperty('position', 'static', 'important');
      }
    } catch (_) {}
    try {
      // FreeCoinPay-style marker class set when the detector fires
      if (document.body) document.body.classList.remove('has-adblock');
    } catch (_) {}
    try {
      const candidates = [document.documentElement, document.body]
        .concat(Array.from(document.body ? document.body.querySelectorAll(':scope > *, :scope > * > *') : []));
      for (const el of candidates) {
        if (!el || !el.style) continue;
        const cs = realGCS(el);
        if (cs.filter && cs.filter.indexOf('blur') !== -1) el.style.setProperty('filter', 'none', 'important');
      }
    } catch (_) {}
  }

  function killEl(el, reason) {
    if (!el) return;
    LOG('removing', reason, el);
    if (CONFIG.hideInsteadOfDelete) {
      try { el.style.setProperty('display', 'none', 'important'); } catch (_) {}
      return;
    }
    try { el.remove(); } catch (_) {}
  }

  function isWallLike(el) {
    if (!el || el.nodeType !== 1) return false;
    const text = (el.innerText || el.textContent || '').toLowerCase();
    if (!KEYWORD_RE.test(text)) return false;
    try {
      const cs = realGCS(el);
      const pos = cs.position;
      const z = parseInt(cs.zIndex, 10) || 0;
      const r = el.getBoundingClientRect();
      const covers = r.width > window.innerWidth * 0.7 && r.height > window.innerHeight * 0.7;
      return (pos === 'fixed' || pos === 'absolute') && (z > 100 || covers);
    } catch (_) { return false; }
  }

  function collectWallCandidates(scope) {
    const out = [];
    const push = (el) => { if (el && el.nodeType === 1) out.push(el); };
    try {
      if (!scope || scope === document || scope === document.documentElement || scope === document.body) {
        document.querySelectorAll(OVERLAY_SEL).forEach(push);
        // Top-level walls often carry no recognisable id/class (e.g. #abkBar),
        // so always inspect the body's direct children too.
        if (document.body) Array.from(document.body.children).forEach(push);
      } else if (scope.nodeType === 1) {
        push(scope);
        scope.querySelectorAll('div,section,aside,span,p,button,a').forEach(push);
      }
    } catch (_) {}
    return out;
  }

  function removeOverlays(root) {
    const scopes = [];
    if (!root) {
      scopes.push(document);
    } else if (root.nodeType === 1) {
      scopes.push(root);
    }
    for (const scope of scopes) {
      for (const el of collectWallCandidates(scope)) {
        if (isWallLike(el)) killEl(el, 'wall');
      }
    }
    // full-screen backdrops with no text / no media
    try {
      document.querySelectorAll('[class*="overlay"],[class*="backdrop"],[id*="overlay"],[id*="backdrop"]').forEach((el) => {
        const text = (el.innerText || el.textContent || '').trim();
        const media = el.querySelector('img,video,canvas,svg');
        const cs = realGCS(el);
        const z = parseInt(cs.zIndex, 10) || 0;
        const r = el.getBoundingClientRect();
        if (!media && text.length < 3 && z >= 10 && r.width > window.innerWidth * 0.85 && r.height > window.innerHeight * 0.85) {
          killEl(el, 'backdrop');
        }
      });
    } catch (_) {}
  }

  function startOverlayWatcher() {
    if (!CONFIG.removeOverlays) return;

    const flush = () => {
      try { sanitizePage(); restoreBodyIfEmpty(); removeOverlays(null); restorePage(); } catch (e) { LOG('flush error', e); }
    };
    let pending = false;
    const schedule = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; flush(); }, 80);
    };

    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' || (m.addedNodes && m.addedNodes.length)) { schedule(); return; }
      }
    });
    try {
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['abp'],
      });
    } catch (_) {
      try { observer.observe(document, { childList: true, subtree: true }); } catch (__) {}
    }

    flush();
    sweepTimer = setInterval(() => {
      if (sweepCount++ >= CONFIG.maxSweeps) {
        clearInterval(sweepTimer); sweepTimer = null; return;
      }
      flush();
    }, CONFIG.sweepIntervalMs);
    LOG('overlay watcher started');
  }

  // ------------------------------------------------------- timer filtering
  const AD_TIMER_RE = /adblock|adblocker|adb|blocker|detector|blockadblock|fuckadblock/i;

  function protectTimer(name) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    const wrapped = mask(function (fn, delay, ...args) {
      if (typeof fn === 'string' && AD_TIMER_RE.test(fn)) {
        LOG('blocked timer', name, fn.slice(0, 80));
        return 0;
      }
      return orig.call(this, fn, delay, ...args);
    }, orig);
    try {
      Object.defineProperty(window, name, { configurable: true, writable: true, value: wrapped });
    } catch (_) { /* ignore */ }
  }

  function neutralizeTimers() {
    if (!CONFIG.neutralizeTimers) return;
    protectTimer('setTimeout');
    protectTimer('setInterval');
    LOG('timer filtering installed');
  }

  // ------------------------------------------------- detector storage purge
  const STORAGE_KEYS = [
    '__adblocker', 'OB-AD-BLOCKER-STAT', 'adb', 'adblock', 'adblocker',
    'blockAdBlock', 'fuckAdBlock', 'adb_detected', 'adblock_detected',
    'bm_last_load_status', 'pf_blocking', 'pagefair',
  ];

  // Legacy Adblock Plus / BlockAdBlock marker: `document.body.getAttribute('abp')`.
  function sanitizePage() {
    try { if (document.body) document.body.removeAttribute('abp'); } catch (_) {}
    try { if (document.documentElement) document.documentElement.removeAttribute('abp'); } catch (_) {}
  }

  function clearDetectorStorage() {
    if (!CONFIG.clearDetectorStorage) return;
    for (const store of [localStorage, sessionStorage]) {
      try { STORAGE_KEYS.forEach((k) => store.removeItem(k)); } catch (_) {}
    }
    try {
      document.cookie.split(';').forEach((part) => {
        const name = part.split('=')[0].trim();
        if (/adblock|adb|blocker|bm_last_load_status|pagefair/i.test(name)) {
          document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
        }
      });
    } catch (_) {}
    LOG('detector storage purged');
  }

  // --------------------------------------------------- inline script rewriting
  function installInlineRewriter() {
    if (!CONFIG.inlineRules.length) return;
    if (!('beforescriptexecute' in document)) {
      LOG('inline rewriter skipped: beforescriptexecute not supported');
      return;
    }
    document.addEventListener('beforescriptexecute', (e) => {
      const el = e.target;
      if (!el || typeof el.textContent !== 'string') return;
      let src = el.textContent;
      for (const [re, rep] of CONFIG.inlineRules) {
        try { src = src.replace(re, rep); } catch (_) {}
      }
      if (src !== el.textContent) {
        LOG('rewrote inline detector script');
        el.textContent = src;
      }
    });
    LOG('inline rewriter installed');
  }

  // --------------------------------------------------------------- teardown
  function teardown() {
    if (observer) { try { observer.disconnect(); } catch (_) {} observer = null; }
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
    LOG('torn down');
  }
  window.addEventListener('pagehide', teardown, { once: true });

  // ------------------------------------------------------------------ init
  try { installGlobalStubs(); } catch (e) { LOG('global stubs failed', e); }
  try { neutralizeDetectorConfig(); } catch (e) { LOG('detector config failed', e); }
  try { preventBodyWipe(); } catch (e) { LOG('body-wipe guard failed', e); }
  try { sanitizePage(); } catch (e) { LOG('sanitize failed', e); }
  try { spoofNetwork(); } catch (e) { LOG('network spoof failed', e); }
  try { if (CONFIG.spoofBait) spoofBaitGeometry(); } catch (e) { LOG('geometry failed', e); }
  try { neutralizeTimers(); } catch (e) { LOG('timers failed', e); }
  try { clearDetectorStorage(); } catch (e) { LOG('storage failed', e); }
  try { installInlineRewriter(); } catch (e) { LOG('inline rewriter failed', e); }

  const startWatcher = () => {
    try { startOverlayWatcher(); } catch (e) { LOG('watcher failed', e); }
  };
  try { document.addEventListener('DOMContentLoaded', sanitizePage, { once: true }); } catch (_) {}
  try { document.addEventListener('DOMContentLoaded', snapshotBody, { once: true }); } catch (_) {}
  try { window.addEventListener('load', sanitizePage, { once: true }); } catch (_) {}
  try { window.addEventListener('load', snapshotBody, { once: true }); } catch (_) {}
  // documentElement already exists at document-start, so the observer can be
  // active before the body (and any early detector overlay) is parsed.
  if (document.documentElement) {
    startWatcher();
  } else {
    document.addEventListener('DOMContentLoaded', startWatcher, { once: true });
  }

  LOG('ready');
  try { console.info('%c[ADB-Bypass]%c v2.0.0 ready', 'color:#0a0;font-weight:bold', 'color:inherit'); } catch (_) {}
})();
