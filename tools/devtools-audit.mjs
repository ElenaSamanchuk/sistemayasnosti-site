// Аудит «как в DevTools» без ИИ: консоль, сеть, хранилища, вес, LCP/CLS, картинки, пассивная безопасность, доступность.
// Один Chromium без окна, страницы по очереди, живой сайт не открывается, внешние запросы перехватываются и считаются (в сеть не уходят).
// Запуск: node tools/devtools-audit.mjs [/ /mini ...]. Отчёт docs/devtools-audit.json. Код выхода 1 при ошибках уровня «блокер»
// (ошибки консоли, 4xx/5xx локальных файлов, смешанный контент, target=_blank без noopener, токены в inline-коде, кнопки без имени, горизонтальная прокрутка).
import { chromium } from 'playwright';
import fs from 'node:fs';
import { startPreview } from './preview-static.mjs';

const ALL = JSON.parse(fs.readFileSync('public/content/routes.json', 'utf8')).map((r) => r.path);
const requested = process.argv.slice(2);
const routes = requested.length ? requested : ALL;
const VIEWS = {
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const server = await startPreview(0);
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const host = (u) => { try { return new URL(u).host; } catch { return '[?]'; } };
const safe = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return '[адрес]'; } };
const isLocal = (u) => u.startsWith(ORIGIN + '/') || u.startsWith('data:') || u.startsWith(`blob:${ORIGIN}/`);

// Всё, что считается внутри страницы
const inPage = {
  vitals: () => ({ lcp: window.__lcp || null, cls: window.__cls || 0 }),
  security: () => {
    const html = document.documentElement.outerHTML;
    const inline = [...document.querySelectorAll('script:not([src])')].map((s) => s.textContent);
    const tokenRe = /(?:api[_-]?key|secret|token|passw(?:or)?d|authorization|bearer)\s*["']?\s*[:=]\s*["'][A-Za-z0-9_\-./+=]{16,}["']/i;
    const longRe = /["'`][A-Fa-f0-9]{32,}["'`]|["'`][A-Za-z0-9_\-]{40,}["'`]/;
    const tokens = [];
    inline.forEach((code, i) => { const m = code.match(tokenRe) || code.match(longRe); if (m) tokens.push({ script: i, sample: m[0].slice(0, 12) + '…(' + m[0].length + ' зн.)' }); });
    const blank = [...document.querySelectorAll('a[target="_blank"]')].filter((a) => !/\bnoopener\b/.test(a.rel)).map((a) => a.getAttribute('href'));
    const httpAttrs = [...document.querySelectorAll('[href],[src],[action],[poster],[srcset]')].flatMap((el) => ['href', 'src', 'action', 'poster', 'srcset'].map((a) => [a, el.getAttribute(a)]))
      .filter(([, v]) => v && /(^|[\s,])http:\/\//i.test(v) && !/^http:\/\/127\.0\.0\.1/.test(v)).map(([a, v]) => `${a}=${v.slice(0, 80)}`);
    const httpText = (html.match(/http:\/\/(?!www\.w3\.org)[^\s"'<>)]+/g) || []).filter((u) => !/127\.0\.0\.1|localhost/.test(u)).slice(0, 10);
    const forms = [...document.forms].map((f) => ({ action: f.getAttribute('action'), method: f.method }));
    return { inlineScripts: inline.length, tokens, blankWithoutNoopener: blank, httpAttrs, httpInText: httpText, forms, metaCsp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') };
  },
  images: () => [...document.images].map((img) => {
    const r = img.getBoundingClientRect(); const cs = getComputedStyle(img);
    const hidden = !img.getClientRects().length || cs.display === 'none' || cs.visibility === 'hidden';
    return { src: (img.currentSrc || img.src).split('/').slice(-3).join('/'), natural: [img.naturalWidth, img.naturalHeight], shown: [Math.round(r.width), Math.round(r.height)], hidden, lazy: img.loading === 'lazy', alt: img.hasAttribute('alt'), ratio: r.width ? +(img.naturalWidth / (r.width * devicePixelRatio)).toFixed(2) : null };
  }),
  headings: () => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.getClientRects().length).map((h) => ({ level: +h.tagName[1], text: h.textContent.trim().replace(/\s+/g, ' ').slice(0, 50) })),
  a11y: () => {
    const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || el.textContent || el.getAttribute('title') || el.querySelector('img[alt]')?.alt || '').trim();
    const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const buttons = [...document.querySelectorAll('button,[role=button],a[href]')].filter(vis);
    const noName = buttons.filter((b) => !name(b)).map((b) => `${b.tagName.toLowerCase()}.${(b.className + '').split(' ')[0]}${b.getAttribute('href') ? '[' + b.getAttribute('href').slice(0, 40) + ']' : ''}`);
    const fields = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis);
    const noLabel = fields.map((f) => ({ f, ok: f.getAttribute('aria-label') || f.getAttribute('aria-labelledby') || f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`) || f.closest('label') })).filter((x) => !x.ok).map((x) => `${x.f.tagName.toLowerCase()}[name=${x.f.name || ''}][ph=${x.f.placeholder || ''}]`);
    return { visibleLinksAndButtons: buttons.length, noAccessibleName: noName.slice(0, 20), fields: fields.length, fieldsWithoutLabel: noLabel, lang: document.documentElement.lang, title: document.title };
  },
  contrast: (selector) => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const out = [];
    for (const el of document.querySelectorAll(selector)) {
      if (!el.getClientRects().length) continue;
      const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30); if (!text) continue;
      const cs = getComputedStyle(el); let fg = parse(cs.color); if (!fg) continue;
      let bg = null, unknown = false, node = el; const layers = [];
      while (node && node.nodeType === 1) {
        const s = getComputedStyle(node);
        if (s.backgroundImage && s.backgroundImage !== 'none') { unknown = true; break; }
        const c = parse(s.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
        node = node.parentElement;
      }
      if (unknown) { out.push({ text, unknown: 'фон-картинка' }); continue; }
      let base = { r: 255, g: 255, b: 255, a: 1 }; for (const c of layers.reverse()) base = blend(c, base);
      fg = blend({ ...fg, a: fg.a * (parseFloat(cs.opacity) || 1) }, base);
      const L1 = lum(fg), L2 = lum(base); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700; const large = px >= 24 || (px >= 18.66 && bold);
      out.push({ text, ratio: +ratio.toFixed(2), size: px, large, ok: ratio >= (large ? 3 : 4.5) });
    }
    return out;
  },
};

async function focusAudit(page, selector, limit = 14) {
  // Фокус по видимым элементам области: у сфокусированного должен быть видимый признак (контур, тень или смена цвета/фона/подчёркивания)
  const count = await page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).length, selector);
  const out = [];
  for (let i = 0; i < Math.min(count, limit); i++) {
    const r = await page.evaluate(async ({ s, i }) => {
      const el = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length)[i]; if (!el) return null;
      const snap = () => { const c = getComputedStyle(el); return { o: c.outlineStyle + '|' + c.outlineWidth + '|' + c.outlineColor, bs: c.boxShadow, col: c.color, bg: c.backgroundColor, bc: c.borderColor, td: c.textDecorationLine, op: c.opacity }; };
      el.blur(); await new Promise((res) => setTimeout(res, 350)); const before = snap();
      el.focus({ focusVisible: true }); await new Promise((res) => setTimeout(res, 450));
      const after = snap(); const label = (el.getAttribute('aria-label') || el.textContent || el.className || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      const ring = after.o !== before.o && !/^none/.test(after.o) && !/\|0px\|/.test(after.o);
      const changed = ring || after.bs !== before.bs || after.col !== before.col || after.bg !== before.bg || after.bc !== before.bc || after.td !== before.td || after.op !== before.op;
      return { label, ring, changed, focusVisible: el.matches(':focus-visible') };
    }, { s: selector, i });
    if (r) out.push(r);
  }
  return out;
}

const results = [];
for (const route of routes) for (const view of Object.keys(VIEWS)) {
  const r = { path: route, view, problems: [], warnings: [] };
  const context = await browser.newContext({ ...VIEWS[view], locale: 'ru-RU' });
  await context.addInitScript(() => {
    window.__cls = 0; window.__lcp = null;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { const e = l.getEntries().at(-1); window.__lcp = { time: Math.round(e.startTime), size: e.size, el: e.element ? e.element.tagName.toLowerCase() + '.' + (e.element.className + '').split(' ')[0] : null, url: e.url ? e.url.split('/').slice(-2).join('/') : null }; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const page = await context.newPage();
  const console_ = [], failed = [], external = [], resources = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console_.push({ type: m.type(), text: m.text().slice(0, 200) }); });
  page.on('pageerror', (e) => console_.push({ type: 'pageerror', text: e.message.slice(0, 200) }));
  page.on('response', async (resp) => {
    const u = resp.url(); if (!u.startsWith(ORIGIN + '/')) return;
    if (resp.status() >= 400) failed.push(`${resp.status()} ${safe(u)}`);
    const len = Number(resp.headers()['content-length'] || 0);
    resources.push({ url: new URL(u).pathname, status: resp.status(), type: resp.request().resourceType(), bytes: len, range: resp.status() === 206 });
  });
  page.on('requestfailed', (q) => { if (q.url().startsWith(ORIGIN + '/') && q.failure()?.errorText !== 'net::ERR_ABORTED') failed.push(`${q.failure()?.errorText} ${safe(q.url())}`); });
  await page.route('**/*', (route) => {
    const q = route.request();
    if (isLocal(q.url())) return route.continue();
    external.push({ method: q.method(), host: host(q.url()), url: safe(q.url()), type: q.resourceType() });
    return route.abort();
  });
  try {
    await page.goto(ORIGIN + route, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('main', { state: 'attached', timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);
    // Первый экран: сколько реально загружено до прокрутки
    const initial = await page.evaluate(() => { const e = performance.getEntriesByType('resource'); return { requests: e.length, bytes: e.reduce((s, x) => s + (x.encodedBodySize || 0), 0) }; });
    const before = await page.evaluate(inPage.vitals);
    // Полный проход сверху вниз, как у посетителя
    let h = await page.evaluate(() => document.documentElement.scrollHeight); const step = Math.floor(VIEWS[view].viewport.height * 0.8);
    for (let y = 0; y < h + step; y += step) { await page.evaluate((t) => window.scrollTo(0, t), y); await page.waitForTimeout(150); h = await page.evaluate(() => document.documentElement.scrollHeight); }
    if (route.startsWith('/audio-club')) await page.waitForSelector('main #sya-club h1', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const vit = await page.evaluate(inPage.vitals);
    const dims = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    r.dims = dims; r.initial = initial; r.vitals = { lcp: before.lcp, clsFirstScreen: +before.cls.toFixed(4), clsAfterFullScroll: +vit.cls.toFixed(4) };
    if (dims.scrollWidth > dims.width) r.problems.push(`горизонтальная прокрутка ${dims.scrollWidth}>${dims.width}`);
    r.storage = await page.evaluate(() => ({
      localStorage: Object.fromEntries(Object.keys(localStorage).map((k) => [k, String(localStorage.getItem(k)).slice(0, 40)])),
      sessionStorage: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, String(sessionStorage.getItem(k)).slice(0, 40)])),
      cookieNames: document.cookie ? document.cookie.split('; ').map((c) => c.split('=')[0]) : [],
    }));
    r.cookies = (await context.cookies()).map((c) => ({ name: c.name, domain: c.domain, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
    const total = resources.reduce((s, x) => s + x.bytes, 0);
    r.network = { localRequests: resources.length, localBytes: total, byType: Object.entries(resources.reduce((m, x) => { m[x.type] = (m[x.type] || 0) + x.bytes; return m; }, {})).map(([type, bytes]) => ({ type, bytes })), largest: [...resources].sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((x) => ({ url: x.url, bytes: x.bytes, partial: x.range })), failed, externalBlocked: external.length };
    r.externalHosts = Object.entries(external.reduce((m, x) => { const k = `${x.method} ${x.host}`; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, n]) => ({ request: k, count: n }));
    r.console = console_;
    const imgs = await page.evaluate(inPage.images);
    r.images = { total: imgs.length, hidden: imgs.filter((i) => i.hidden).length, hiddenLoaded: imgs.filter((i) => i.hidden && i.natural[0] > 0).map((i) => ({ src: i.src, natural: i.natural })).slice(0, 10), oversized: imgs.filter((i) => !i.hidden && i.ratio && i.ratio > 2 && !/\.svg$/.test(i.src)).map((i) => ({ src: i.src, natural: i.natural, shown: i.shown, ratio: i.ratio })).slice(0, 10), noAlt: imgs.filter((i) => !i.alt).length, broken: imgs.filter((i) => !i.hidden && i.natural[0] === 0 && !i.lazy).map((i) => i.src) };
    r.security = await page.evaluate(inPage.security);
    r.headings = await page.evaluate(inPage.headings);
    r.headingIssues = [];
    r.headings.forEach((x, i) => { const prev = r.headings[i - 1]; if (i === 0 && x.level !== 1) r.headingIssues.push(`первый заголовок h${x.level} «${x.text}»`); if (prev && x.level - prev.level > 1) r.headingIssues.push(`пропуск h${prev.level}→h${x.level} «${x.text}»`); });
    r.headingIssues = r.headingIssues.slice(0, 8);
    r.a11y = await page.evaluate(inPage.a11y);
    // Меню: на телефоне сначала открываем бургер
    if (view === '390') { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); await page.tap('.site-burger'); await page.waitForTimeout(700); }
    const navContrast = await page.evaluate(inPage.contrast, '.site-nav__link, .site-nav__button');
    const burgerFocus = view === '390' ? await focusAudit(page, '.site-burger', 1) : [];
    const menuFocus = await focusAudit(page, '.site-nav__link, .site-nav__button, .site-nav__logo', 8);
    if (view === '390') { await page.tap('.site-burger'); await page.waitForTimeout(500); }
    r.a11y.menu = { contrast: navContrast.filter((c) => c.ok === false || c.unknown), contrastMin: Math.min(...navContrast.filter((c) => c.ratio).map((c) => c.ratio), 99), focus: [...burgerFocus, ...menuFocus], noVisibleFocus: [...burgerFocus, ...menuFocus].filter((f) => !f.changed).map((f) => f.label) };
    r.a11y.buttonsContrast = (await page.evaluate(inPage.contrast, '.scene-button .scene-atom, .site-footer a, button')).filter((c) => c.ok === false || c.unknown).slice(0, 12);
    // Форма в попапе (только где есть ссылка на неё)
    const hasForm = await page.evaluate(() => [...document.querySelectorAll('a[href="#zeropopup"]')].some((x) => x.getClientRects().length));
    if (hasForm) {
      await page.evaluate(() => { const a = [...document.querySelectorAll('a[href="#zeropopup"]')].find((x) => x.getClientRects().length); a.scrollIntoView({ block: 'center', behavior: 'instant' }); });
      await page.waitForTimeout(800);
      await page.evaluate(() => [...document.querySelectorAll('a[href="#zeropopup"]')].find((x) => x.getClientRects().length).click());
      await page.waitForSelector('.native-dialog .zero-form__input', { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(800);
      const form = await page.evaluate(() => {
        const d = document.querySelector('.native-dialog'); if (!d) return null;
        const vis = (e) => e.getClientRects().length;
        return { role: d.getAttribute('role'), ariaModal: d.getAttribute('aria-modal'), ariaLabel: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby'),
          inputs: [...d.querySelectorAll('input')].filter(vis).map((i) => ({ name: i.name, type: i.type, label: i.getAttribute('aria-label') || null, placeholder: i.placeholder, autocomplete: i.autocomplete || null })),
          buttons: [...d.querySelectorAll('button,.popup-close,[role=button]')].filter(vis).map((b) => ({ cls: (b.className + '').split(' ')[0], name: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30), tag: b.tagName.toLowerCase() })) };
      });
      const fFocus = await focusAudit(page, '.native-dialog .zero-form__input, .native-dialog .zero-form__submit, .native-dialog .zero-form__country, .native-dialog .popup-close', 8);
      const fContrast = await page.evaluate(inPage.contrast, '.native-dialog .zero-form__submit, .native-dialog .zero-form__input, .native-dialog .zero-form__country, .native-dialog .popup-close');
      r.a11y.form = { dialog: form, focus: fFocus, noVisibleFocus: fFocus.filter((f) => !f.changed).map((f) => f.label), contrast: fContrast };
      // Фокус не должен уходить за окно: после Tab x6 активный элемент остаётся в диалоге
      for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
      r.a11y.form.focusTrapped = await page.evaluate(() => !!document.activeElement?.closest('.native-dialog'));
    }
    // Нарушения уровня «блокер»
    if (console_.filter((c) => c.type === 'error' || c.type === 'pageerror').length) r.problems.push('ошибки консоли');
    if (failed.length) r.problems.push('4xx/5xx или отказ загрузки локальных файлов');
    if (r.security.tokens.length) r.problems.push('похожий на токен текст в inline-скрипте');
    if (r.security.blankWithoutNoopener.length) r.problems.push('target=_blank без noopener');
    if (r.security.httpAttrs.length) r.problems.push('адреса http:// в атрибутах');
    if (external.some((x) => /^http:/.test(x.url))) r.problems.push('смешанный контент: запросы по http://');
    if (r.a11y.noAccessibleName.length) r.warnings.push('ссылки-иконки без доступного имени');
    if (r.a11y.fieldsWithoutLabel.length) r.warnings.push('поля без подписи');
    if (r.a11y.menu.noVisibleFocus.length) r.warnings.push('меню: нет видимого фокуса');
    if (r.a11y.form?.noVisibleFocus.length) r.warnings.push('форма: нет видимого фокуса');
    if (r.a11y.menu.contrast.some((c) => c.ok === false)) r.warnings.push('меню: контраст ниже нормы');
    if (r.a11y.form?.contrast.some((c) => c.ok === false)) r.warnings.push('форма: контраст ниже нормы');
    if (r.headingIssues.length) r.warnings.push('порядок заголовков');
    if (r.vitals.clsAfterFullScroll > 0.1) r.warnings.push(`CLS ${r.vitals.clsAfterFullScroll}`);
    if (r.vitals.lcp && r.vitals.lcp.time > 2500) r.warnings.push(`LCP ${r.vitals.lcp.time} мс (локально, без сети)`);
  } catch (e) { r.problems.push(e.message.split('\n')[0]); }
  results.push(r);
  console.log(`${r.problems.length ? 'ОШИБКА' : 'ок'}  ${route}@${view}  запросов ${r.network?.localRequests}  ${Math.round((r.network?.localBytes || 0) / 1024)} КБ  LCP ${r.vitals?.lcp?.time}  CLS ${r.vitals?.clsAfterFullScroll}  внешних заблок. ${r.network?.externalBlocked}  ${r.problems.concat(r.warnings.map((w) => '~' + w)).join('; ')}`);
  await context.close();
}
await browser.close(); server.close();
fs.writeFileSync('docs/devtools-audit.json', JSON.stringify({ at: new Date().toISOString(), note: 'локальная статика (dist), живой сайт не открывался; LCP/CLS без сетевых задержек и без метрики/Kommo, внешние запросы перехвачены и посчитаны', routes, results }, null, 1));
const bad = results.filter((x) => x.problems.length);
if (bad.length) { console.error(`Аудит: проблем на ${bad.length} из ${results.length}, подробности в docs/devtools-audit.json`); process.exit(1); }
console.log(`Аудит пройден без блокеров: ${results.length} проверок`);
process.exit(0);
