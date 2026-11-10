// Сверка отступов и размеров вне абсолютной раскладки: живая Тильда (эталон) против переноса.
// Запуск: nice node tools/compare-spacing.mjs [--routes=/,/about] [--widths=1440,1920,390,360] [--scopes=nav,footer]
//         [--live=https://sistemayasnosti.com] [--local=https://хост/путь | --dist] [--out=docs/compare-spacing.json] [--dump=сырые.json]
// Что покрыто (scopes): nav (шапка и меню на десктопе, панель с бургером на телефоне), nav-open (открытый бургер),
//   footer, legal (/oferta /privacy /consent /cookie), cookie (плашка), audio (/audio-club), buttons (все кнопки страницы),
//   popup (форма на /taplink, открыть и не отправлять), records (padding записи, высота, зазоры, поля до содержимого).
// Метод: на каждой стороне собираются видимые элементы области, пары ищутся по тексту; сравниваются padding, margin, gap,
//   border, border-radius, кегль, начертание, цвет, межстрочный, размеры и зазоры до соседей в экранных пикселях
//   (computed-значения умножаются на zoom и transform предков: у живого масштаб zoom, у превью transform). Допуск 1 px.
// Один headless Chromium, страницы по очереди; на живой сайт только GET; формы не отправляются (запросы кроме GET/HEAD обрываются).
// Код выхода 1, если есть отличия, не объяснённые сознательными решениями. Отчёт: docs/compare-spacing.json.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { startPreview } from './preview-static.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; }));
const LIVE = (args.live || 'https://sistemayasnosti.com').replace(/\/$/, '');
const WIDTHS = (args.widths || '1440,1920,390,360').split(',').map(Number);
const TOL = 1;
const BLOCKED = /mc\.yandex|yandex\.(ru|com)\/metrika|kommo|amocrm|tildastat|stat\.tildacdn|googletag|google-analytics|doubleclick/i;

// Какие области на каких страницах (ширины ограничиваются --widths)
const PLAN = {
  '/': ['nav', 'nav-open', 'footer', 'cookie', 'buttons', 'records'],
  '/clarity': ['buttons', 'records'],
  '/mini': ['buttons', 'records'],
  '/about': ['nav', 'footer', 'buttons', 'records'],
  '/taplink': ['buttons', 'records', 'popup'],
  '/audio-club': ['nav', 'nav-open', 'audio', 'buttons', 'footer'],
  '/oferta': ['nav', 'legal', 'footer', 'cookie'],
  '/privacy': ['legal'],
  '/consent': ['legal'],
  '/cookie': ['legal'],
};
const SCOPES = {
  nav: { live: '.tmenu-mobile, .t228', local: '.site-bar, .site-nav', origin: 'viewport' },
  'nav-open': { live: '.tmenu-mobile, .t228', local: '.site-bar, .site-nav', origin: 'viewport', phoneOnly: true },
  footer: { live: '#rec1491047383, #rec1580656743', local: '#rec1491047383, #rec1580656743', origin: 'root' },
  legal: { live: '.t-rec:has(.t004)', local: 'article.native-article', origin: 'root' },
  cookie: { live: '.cookieBanner', local: '.cookieBanner', origin: 'viewport' },
  audio: { live: '#sya-club', local: '#sya-club', origin: 'root' },
  popup: { live: '.t-popup_show', local: '.native-modal', origin: 'viewport' },
};
const only = args.scopes ? args.scopes.split(',') : null;
const routes = (args.routes ? args.routes.split(',') : Object.keys(PLAN));
for (const r of routes) if (!PLAN[r]) throw new Error(`Неизвестная страница: ${r}`);

// ───────── Сбор данных внутри страницы ─────────
function inPage(cfg) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'BR', 'HEAD', 'META', 'LINK', 'I']);
  const norm = (s) => s.replace(/[   ​­]/g, ' ').replace(/[«»“”„"]/g, '"').replace(/[—–−]/g, '-').replace(/[().,:;!?]/g, '').replace(/\s+/g, '').toLowerCase();
  const r1 = (v) => Math.round(v * 100) / 100;
  const scaleOf = (el) => { let s = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = getComputedStyle(e); s *= parseFloat(c.zoom) || 1; if (c.transform !== 'none') { const m = new DOMMatrix(c.transform); s *= Math.hypot(m.a, m.b) || 1; } } return s; };
  const px = (v, s) => { const n = parseFloat(v); return Number.isFinite(n) ? r1(n * s) : 0; };
  const visible = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width >= 1 && r.height >= 1; };
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };

  // Прямоугольник содержимого: объединение текстовых узлов и медиа внутри элемента (не зависит от того, чем задан отступ: padding, margin или обёртка)
  function contentRect(el) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity; let lines = new Set();
    const add = (q) => { if (q.width < 0.5 || q.height < 0.5) return; x0 = Math.min(x0, q.left); y0 = Math.min(y0, q.top); x1 = Math.max(x1, q.right); y1 = Math.max(y1, q.bottom); };
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      if (!t.textContent.trim()) continue; const pe = t.parentElement; if (!pe || pe.closest('svg') || !visible(pe)) continue;
      const rg = document.createRange(); rg.selectNodeContents(t); for (const q of rg.getClientRects()) { add(q); if (q.width > 0.5) lines.add(Math.round(q.top / 3)); }
    }
    for (const m of el.querySelectorAll('img, video, input, textarea, svg')) if (visible(m)) add(m.getBoundingClientRect());
    if (x0 === Infinity) return null;
    return { x0, y0, x1, y1, lines: lines.size };
  }
  const cleanText = (el) => { let out = ''; const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let t = tw.nextNode(); t; t = tw.nextNode()) { const pe = t.parentElement; if (pe && !pe.closest('style, script, noscript, template')) out += ' ' + t.textContent; } return out; };
  function measure(el, org, wantInsets) {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const s = scaleOf(el);
    const side = (p, k) => px(cs[`${p}${k}`], s);
    const lh = cs.lineHeight === 'normal' ? 'normal' : px(cs.lineHeight, s);
    const bw = ['Top', 'Right', 'Bottom', 'Left'].map((k) => (cs[`border${k}Style`] === 'none' ? 0 : px(cs[`border${k}Width`], s)));
    const radius = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => px(cs[`border${k}Radius`].split(' ')[0], s));
    // радиус больше половины меньшей стороны всё равно рисуется как полукруг: приводим к одному значению
    const cap = Math.min(r.width, r.height) / 2;
    return {
      pad: ['Top', 'Right', 'Bottom', 'Left'].map((k) => side('padding', k)),
      mar: ['Top', 'Right', 'Bottom', 'Left'].map((k) => side('margin', k)),
      gap: [px(cs.rowGap, s), px(cs.columnGap, s)],
      bw, bc: ['Top', 'Right', 'Bottom', 'Left'].map((k, i) => (bw[i] ? cs[`border${k}Color`] : '')).filter(Boolean)[0] || '',
      radius: radius.map((v) => Math.round(Math.min(v, cap) * 10) / 10),
      fs: px(cs.fontSize, s), fw: cs.fontWeight, ff: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), lh, ls: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing, s),
      color: cs.color, bg: alpha(cs.backgroundColor) > 0 ? cs.backgroundColor : (cs.backgroundImage !== 'none' ? cs.backgroundImage.replace(/url\([^)]*\)/g, 'url()') : ''), ta: cs.textAlign, disp: cs.display,
      shadow: cs.boxShadow === 'none' ? '' : cs.boxShadow.replace(/-?[\d.]+px/g, (m) => `${r1(parseFloat(m) * s)}px`),
      w: r1(r.width), h: r1(r.height), left: r1(r.left - org.x), top: r1(r.top - org.y), scale: r1(s),
      ...(() => { const c = contentRect(el); if (!c) return { lines: 0, tr: null, insets: null }; return { lines: c.lines, tr: [r1(c.x0 - org.x), r1(c.y0 - org.y), r1(c.x1 - org.x), r1(c.y1 - org.y)], insets: wantInsets ? [r1(c.y0 - r.top), r1(r.right - c.x1), r1(r.bottom - c.y1), r1(c.x0 - r.left)] : null }; })(),
    };
  }

  function collectScope(selector, origin) {
    const roots = [...document.querySelectorAll(selector)].filter((e) => visible(e));
    if (!roots.length) return null;
    const rr = roots[0].getBoundingClientRect();
    const org = origin === 'viewport' ? { x: 0, y: 0 } : { x: rr.left, y: rr.top + 0 };
    const texts = []; const boxes = new Map(); const rootRect = { w: r1(rr.width), h: r1(rr.height) };
    let imgN = 0; let n = 0;
    const seen = new Set();
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (seen.has(el)) continue; seen.add(el);
        const tag = el.tagName.toUpperCase();
        if (SKIP.has(tag) || el.closest('svg')) continue;
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        // скрытое отсечением (кнопка «Что изменилось?», off-screen меню) пропускаем
        const own = [...el.childNodes].filter((x) => x.nodeType === 3 && x.textContent.trim()).map((x) => x.textContent).join(' ');
        const key = norm(own);
        const isMedia = ['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'BUTTON'].includes(tag);
        const hasPad = ['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(cs[`padding${k}`]) > 0);
        const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((k) => cs[`border${k}Style`] !== 'none' && parseFloat(cs[`border${k}Width`]) > 0);
        const framed = hasBorder || ((alpha(cs.backgroundColor) > 0 || cs.backgroundImage !== 'none') && el.getBoundingClientRect().width < innerWidth * 0.98);
        const base = { tag: tag.toLowerCase(), cls: String(el.className).slice(0, 50) };
        if (key) {
          // рамка кнопки/плашки у самого текстового элемента: дополнительно учитываем её как контейнер, чтобы пары находились при разной вёрстке (у живой Тильды рамка и текст в разных элементах)
          if (framed) { const tc0 = norm(cleanText(el)).slice(0, 40); const bk0 = `box:${tc0}`; if (!boxes.has(bk0)) boxes.set(bk0, []); boxes.get(bk0).push({ ...base, framed, text: cleanText(el).replace(/\s+/g, ' ').trim().slice(0, 40), ...measure(el, org, true), order: n }); }
          texts.push({ ...base, key, kind: 'text', framed, text: own.replace(/\s+/g, ' ').trim().slice(0, 60), ...measure(el, org, framed), order: n++ });
        } else if (tag === 'IMG') {
          texts.push({ ...base, key: `img#${++imgN}`, kind: 'img', text: el.getAttribute('alt') || (el.getAttribute('src') || 'img').split('/').pop().slice(0, 30), ...measure(el, org), order: n++ });
        } else if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
          // рамка поля: сам input или ближайший предок до 3 уровней с заливкой/границей, охватывающий поле (у живой Тильды рамка у обёртки)
          let fr = el; for (let a = el.parentElement, i = 0; a && i < 3; a = a.parentElement, i++) { const ac = getComputedStyle(a); if (alpha(ac.backgroundColor) > 0 || parseFloat(ac.borderTopWidth) > 0) { fr = a; break; } }
          const own0 = alpha(getComputedStyle(el).backgroundColor) > 0 || parseFloat(getComputedStyle(el).borderTopWidth) > 0; if (own0) fr = el;
          texts.push({ ...base, key: `${tag.toLowerCase()}#${++imgN}`, kind: 'input', text: el.getAttribute('placeholder') || el.getAttribute('name') || tag, ...measure(fr, org), order: n++ });
        } else if (framed || ['SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER'].includes(tag) || (hasPad && el.getBoundingClientRect().width >= rr.width * 0.7)) {
          const tc = norm(cleanText(el)).slice(0, 40);
          if (!tc && !framed) continue;
          { const q = el.getBoundingClientRect(); if (q.width < 30 && q.height < 30) continue; }
          const bk = `box:${tc || `${tag}#${++imgN}`}`;
          if (!boxes.has(bk)) boxes.set(bk, []);
          boxes.get(bk).push({ ...base, framed, text: cleanText(el).replace(/\s+/g, ' ').trim().slice(0, 40), ...measure(el, org, true), order: n++ });
        }
      }
    }
    // цепочки обёрток вокруг одного содержимого сворачиваем: суммы отступов, внешний размер
    const chains = [];
    for (const [key, list] of boxes) {
      const sum = (f) => [0, 1, 2, 3].map((i) => r1(list.reduce((a, b) => a + b[f][i], 0)));
      const outer = list.reduce((a, b) => (b.w * b.h >= a.w * a.h ? b : a), list[0]);
      chains.push({ key, kind: 'box', text: outer.text, tag: list.map((x) => x.tag).join('>'), cls: list.map((x) => x.cls).join(' > ').slice(0, 80), insets: outer.insets, bw: sum('bw'), bc: list.find((x) => x.bc)?.bc || '', radius: outer.radius, bg: list.find((x) => x.bg)?.bg || '', shadow: list.find((x) => x.shadow)?.shadow || '', gap: outer.gap, w: outer.w, h: outer.h, left: outer.left, top: outer.top, count: list.length, order: list[0].order });
    }
    // ключи картинок и полей: порядковый номер по положению (сверху вниз, слева направо), а не по порядку в разметке
    for (const kind of ['img', 'input']) texts.filter((t) => t.kind === kind).sort((p, q) => Math.round(p.top / 4) - Math.round(q.top / 4) || p.left - q.left).forEach((t, i) => { t.key = `${kind}#${i + 1}`; });
    for (const c of chains) if (!c.text) c.text = `[${c.tag.split('>')[0]}${c.cls ? '.' + c.cls.split(' ')[0] : ''}]`;
    return { rootRect, items: [...texts, ...chains] };
  }

  function buttons() {
    const out = []; let n = 0; const seen = new Map();
    const cands = [...document.querySelectorAll('a, button, [class*=btn], [class*=button], .tn-atom__button-content, .scene-atom__button-content')];
    for (const el of cands) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      const hasBorder = ['Top', 'Left'].some((k) => cs[`border${k}Style`] !== 'none' && parseFloat(cs[`border${k}Width`]) > 0);
      const hasBg = alpha(cs.backgroundColor) > 0 || cs.backgroundImage !== 'none';
      if (r.width < 40 || r.height < 24 || r.width > innerWidth || !(hasBorder || hasBg)) continue;
      if (el.querySelector('a, button') && el.tagName !== 'A') continue; // обёртки
      if (r.height > 120) continue;
      const text = norm(cleanText(el));
      if (!text) continue;
      // внутри кнопки-ссылки берём внешний «кадр»: пропустим, если родитель тоже кнопка с тем же текстом и рамкой
      const kk = text; const c = (seen.get(kk) || 0) + 1; seen.set(kk, c);
      out.push({ key: `btn:${kk}#${c}`, kind: 'button', text: cleanText(el).replace(/\s+/g, ' ').trim().slice(0, 40), tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), ...measure(el, { x: 0, y: 0 }, true), order: n++ });
    }
    return out;
  }

  function records() {
    const out = [];
    for (const el of document.querySelectorAll('[id^=rec]')) {
      if (!/^rec\d+$/.test(el.id) || el.querySelector('.cookieBanner')) continue;
      const r = el.getBoundingClientRect(); if (r.height < 1) continue;
      const cs = getComputedStyle(el); const s = scaleOf(el);
      const top = r.top + scrollY; const nodes = [];
      for (const n of el.querySelectorAll('.t396__elem, .scene-node')) {
        const m = /tn-elem__(\d+)/.exec(n.className); if (!m || !visible(n)) continue;
        if (n.closest('.cookieBanner')) continue;
        const q = n.getBoundingClientRect();
        const type = n.querySelector('img,video') ? 'image' : (cleanText(n).trim() ? 'text' : 'shape');
        if (type === 'shape' && (q.height >= r.height * 0.9 || q.width >= r.width * 0.98)) continue;
        nodes.push({ id: m[1], type, top: r1(q.top + scrollY - top), bottom: r1(q.bottom + scrollY - top) });
      }
      const leaves = [];
      if (!nodes.length) {
        for (const n of el.querySelectorAll('*')) {
          const tag = n.tagName.toUpperCase(); if (SKIP.has(tag) || n.closest('svg') || !visible(n)) continue;
          const own = [...n.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim());
          if (!own && !['IMG', 'VIDEO', 'INPUT', 'BUTTON'].includes(tag)) continue;
          if (getComputedStyle(n).position === 'fixed') continue;
          const q = n.getBoundingClientRect(); leaves.push({ top: r1(q.top + scrollY - top), bottom: r1(q.bottom + scrollY - top) });
        }
      }
      out.push({ id: el.id, top: r1(top), height: r1(r.height), pt: px(cs.paddingTop, s), pb: px(cs.paddingBottom, s), mt: px(cs.marginTop, s), mb: px(cs.marginBottom, s), nodes, leaves });
    }
    return out;
  }

  const res = { scopes: {}, buttons: [], records: [] };
  for (const [name, sc] of Object.entries(cfg.scopes)) res.scopes[name] = collectScope(sc.sel, sc.origin);
  if (cfg.buttons) res.buttons = buttons();
  if (cfg.records) res.records = records();
  res.meta = { innerWidth, scrollHeight: document.documentElement.scrollHeight, hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
  return res;
}

// ───────── Прокрутка и ожидание (как в compare-live: проявить блоки, довести анимации) ─────────
async function settle(page) {
  const vh = page.viewportSize().height; let h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h + vh; y += Math.floor(vh * 0.7)) { await page.evaluate((t) => window.scrollTo(0, t), y); await page.waitForTimeout(220); h = await page.evaluate(() => document.documentElement.scrollHeight); }
  await page.waitForTimeout(1500);
  for (let pass = 0; pass < 2; pass++) {
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.t396__elem, .scene-node')].map((e, i) => { e.dataset.cmpIdx = i; return e; }).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).opacity === '0' && getComputedStyle(e).display !== 'none'; }).map((e) => e.dataset.cmpIdx).slice(0, 80));
    for (const i of hidden) { await page.evaluate((k) => document.querySelector(`[data-cmp-idx="${k}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' }), i); await page.waitForTimeout(300); }
  }
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.querySelectorAll('*').forEach((e) => { if (e.scrollLeft) e.scrollLeft = 0; }); window.scrollTo(0, 0); });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { const t = a.effect?.getComputedTiming?.(); if (t && Number.isFinite(t.endTime)) a.finish(); } catch { /* бесконечная */ } }));
  await page.waitForTimeout(400);
}

async function snapshot(browser, side, url, width, scopeNames) {
  const phone = width <= 640;
  const context = await browser.newContext(phone ? { viewport: { width, height: width === 360 ? 780 : 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : { viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => {
    const r = route.request();
    if (r.resourceType() === 'media' || BLOCKED.test(r.url()) || !['GET', 'HEAD'].includes(r.method())) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const fixedScopes = Object.fromEntries(scopeNames.filter((n) => SCOPES[n] && !['popup', 'nav-open'].includes(n)).map((n) => [n, { sel: SCOPES[n][side], origin: SCOPES[n].origin }]));
  const cfg = { scopes: fixedScopes, buttons: scopeNames.includes('buttons'), records: scopeNames.includes('records') };
  const result = { scopes: {}, buttons: [], records: [] };
  try {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) { try { await page.goto(url, { waitUntil: 'load', timeout: 45000 }); lastError = null; break; } catch (e) { lastError = e; } }
    if (lastError) throw lastError;
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1500);
    // плашка куки показывается с задержкой: ждём её (клик не делаем, иначе согласие запишется и плашка скроется)
    if (scopeNames.includes('cookie')) await page.waitForSelector('.cookieBanner', { state: 'visible', timeout: 8000 }).catch(() => {});
    await settle(page);
    Object.assign(result, await page.evaluate(inPage, cfg));
    // попап формы: открыть, замерить, закрыть; ничего не отправлять
    if (scopeNames.includes('popup')) {
      const trigger = page.locator('a[href="#zeropopup"]').first();
      if (await trigger.count()) {
        await trigger.scrollIntoViewIfNeeded(); await trigger.click(); await page.waitForTimeout(2200);
        const r = await page.evaluate(inPage, { scopes: { popup: { sel: SCOPES.popup[side], origin: 'viewport' } } });
        result.scopes.popup = r.scopes.popup;
        await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(600);
      }
    }
    // открытый бургер (только телефон): перезагружать не нужно, замер с чистого верха страницы
    if (scopeNames.includes('nav-open') && phone) {
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);
      const burger = page.locator(side === 'live' ? '.t-menuburger' : '.site-burger').first();
      if (await burger.count()) {
        await burger.click(); await page.waitForTimeout(1600);
        const r = await page.evaluate(inPage, { scopes: { 'nav-open': { sel: SCOPES['nav-open'][side], origin: 'viewport' } }, buttons: true });
        result.scopes['nav-open'] = r.scopes['nav-open'];
        result.openButtons = r.buttons.filter((x) => x.top < 420 && x.top >= 0); // кнопка «Личный кабинет» в раскрытом меню (меню фиксировано у верха окна)
      }
    }
    return result;
  } finally { await context.close(); }
}

// ───────── Сравнение ─────────
const near = (a, b, tol = TOL) => Math.abs(a - b) <= tol;
const SIDES = ['top', 'right', 'bottom', 'left'];
function compareItem(scope, a, b, add) {
  const base = { scope, text: a.text, kind: a.kind, element: `${b.tag}${b.cls ? '.' + b.cls.split(' ')[0] : ''}` };
  const arr = (prop, av, bv, names) => av.forEach((x, i) => { if (!near(x, bv[i])) add({ ...base, prop: names ? `${prop}-${names[i]}` : prop, live: `${x}px`, local: `${bv[i]}px` }); });
  const framed = a.kind === 'button' || a.kind === 'input' || (a.framed && b.framed) || (a.kind === 'box' && (a.bw.some(Boolean) || b.bw.some(Boolean) || a.bg || b.bg));
  // Отступ содержимого внутри рамки/плашки/контейнера (визуальный padding): не зависит от способа вёрстки
  if ((framed || a.kind === 'box') && a.insets && b.insets) arr('inner-spacing', a.insets, b.insets, SIDES);
  if (framed || a.kind === 'box') {
    arr('border-width', a.bw, b.bw, SIDES);
    arr('border-radius', a.radius, b.radius, ['tl', 'tr', 'br', 'bl']);
    if (a.bc !== b.bc && (a.bc || b.bc)) add({ ...base, prop: 'border-color', live: a.bc || '—', local: b.bc || '—' });
    if (a.bg !== b.bg) add({ ...base, prop: 'background-color', live: a.bg || '—', local: b.bg || '—' });
    if (a.shadow !== b.shadow) add({ ...base, prop: 'box-shadow', live: a.shadow || '—', local: b.shadow || '—' });
    if (!near(a.w, b.w)) add({ ...base, prop: 'width', live: `${a.w}px`, local: `${b.w}px` });
    if (!near(a.h, b.h)) add({ ...base, prop: 'height', live: `${a.h}px`, local: `${b.h}px` });
  }
  if (a.gap && a.disp && /flex|grid/.test(a.disp) && /flex|grid/.test(b.disp) && a.kind === 'box') arr('gap', a.gap, b.gap, ['row', 'column']);
  if (a.kind === 'text') {
    if (!near(a.fs, b.fs, 0.5)) add({ ...base, prop: 'font-size', live: `${a.fs}px`, local: `${b.fs}px` });
    if (a.fw !== b.fw) add({ ...base, prop: 'font-weight', live: a.fw, local: b.fw });
    if (a.color !== b.color) add({ ...base, prop: 'color', live: a.color, local: b.color });
    if (typeof a.lh === 'number' && typeof b.lh === 'number' && !near(a.lh, b.lh, 1)) add({ ...base, prop: 'line-height', live: `${a.lh}px`, local: `${b.lh}px` });
    if (a.lines !== b.lines) add({ ...base, prop: 'lines', live: String(a.lines), local: String(b.lines) });
    if (!near(a.ls, b.ls, 0.3)) add({ ...base, prop: 'letter-spacing', live: `${a.ls}px`, local: `${b.ls}px` });
    if (a.lines > 1 && a.ta !== b.ta && !(['start', 'left'].includes(a.ta) && ['start', 'left'].includes(b.ta))) add({ ...base, prop: 'text-align', live: a.ta, local: b.ta });
    if (!a.framed && !b.framed && a.lines === b.lines && !near(a.h, b.h, 1.5) && !(typeof a.lh !== 'number' || typeof b.lh !== 'number')) add({ ...base, prop: 'height', live: `${a.h}px`, local: `${b.h}px` });
  }
  // Положение в окне: у фиксированных областей (шапка, плашка куки, попап) сравниваем напрямую
  if (SCOPES[scope]?.origin === 'viewport' && (a.kind === 'text' || a.kind === 'img' || a.kind === 'input' || a.kind === 'button')) {
    const ga = geo(a); const gb = geo(b);
    if (!near(ga.left, gb.left)) add({ ...base, prop: 'position-left', live: `${r2(ga.left)}px`, local: `${r2(gb.left)}px` });
    if (!near(ga.top, gb.top)) add({ ...base, prop: 'position-top', live: `${r2(ga.top)}px`, local: `${r2(gb.top)}px` });
  }
  if ((a.kind === 'img' || a.kind === 'input') && (!near(a.w, b.w) || !near(a.h, b.h))) add({ ...base, prop: 'size', live: `${a.w}×${a.h}px`, local: `${b.w}×${b.h}px` });
}

function pairUp(la, lb) {
  const g = (list) => { const m = new Map(); for (const it of list) { if (!m.has(it.key)) m.set(it.key, []); m.get(it.key).push(it); } return m; };
  const ga = g(la); const gb = g(lb); const pairs = []; const onlyA = []; const onlyB = [];
  for (const k of new Set([...ga.keys(), ...gb.keys()])) {
    const a = ga.get(k) || []; const b = gb.get(k) || []; const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) pairs.push([a[i], b[i]]);
    onlyA.push(...a.slice(n)); onlyB.push(...b.slice(n));
  }
  return { pairs, onlyA, onlyB };
}

// Зазоры до ближайшего соседа сверху (если перекрываются по горизонтали) и слева (если перекрываются по вертикали)
const geo = (it) => (it.kind === 'text' && it.tr ? { left: it.tr[0], top: it.tr[1], w: it.tr[2] - it.tr[0], h: it.tr[3] - it.tr[1] } : { left: it.left, top: it.top, w: it.w, h: it.h });
function neighbourGaps(pairs, add, scope) {
  const items = pairs.filter(([a]) => a.kind === 'text' || a.kind === 'img' || a.kind === 'button' || a.kind === 'input').map(([a, b]) => ({ a, b, ga: geo(a), gb: geo(b) }));
  const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
  for (const it of items) {
    let up = null; let lf = null;
    for (const o of items) {
      if (o === it) continue;
      const gy = it.ga.top - (o.ga.top + o.ga.h);
      if (gy >= -0.5 && ov(it.ga.left, it.ga.left + it.ga.w, o.ga.left, o.ga.left + o.ga.w) > Math.min(it.ga.w, o.ga.w) * 0.5 && (!up || gy < up.gy)) up = { o, gy };
      const gx = it.ga.left - (o.ga.left + o.ga.w);
      if (gx >= -0.5 && ov(it.ga.top, it.ga.top + it.ga.h, o.ga.top, o.ga.top + o.ga.h) > Math.min(it.ga.h, o.ga.h) * 0.5 && (!lf || gx < lf.gx)) lf = { o, gx };
    }
    const mk = (prop, lv, cv, o) => add({ scope, text: it.a.text, kind: it.a.kind, element: `${it.b.tag}.${it.b.cls.split(' ')[0] || ''}`, prop, live: `${r2(lv)}px (до «${o.a.text.slice(0, 24)}»)`, local: `${r2(cv)}px` });
    if (up) { const cv = it.gb.top - (up.o.gb.top + up.o.gb.h); if (!near(up.gy, cv)) mk('gap-above', up.gy, cv, up.o); }
    if (lf) { const cv = it.gb.left - (lf.o.gb.left + lf.o.gb.w); if (!near(lf.gx, cv)) mk('gap-left', lf.gx, cv, lf.o); }
  }
}
const r2 = (v) => Math.round(v * 100) / 100;

function insetCheck(live, local, pairs, add, scope) {
  const ps = pairs.filter(([a]) => a.kind !== 'box');
  if (!ps.length) return;
  const first = (o) => { const g = ps.map((p) => geo(p[o])); return { top: Math.min(...g.map((x) => x.top)), left: Math.min(...g.map((x) => x.left)), right: Math.max(...g.map((x) => x.left + x.w)), bottom: Math.max(...g.map((x) => x.top + x.h)) }; };
  const A = first(0); const B = first(1);
  const rows = [['inset-top', A.top, B.top], ['inset-left', A.left, B.left], ['inset-right', live.rootRect.w - A.right, local.rootRect.w - B.right], ['inset-bottom', live.rootRect.h - A.bottom, local.rootRect.h - B.bottom]];
  for (const [prop, x, y] of rows) if (!near(x, y)) add({ scope, text: '[область]', kind: 'root', element: 'root', prop, live: `${r2(x)}px`, local: `${r2(y)}px` });
  if (!near(live.rootRect.h, local.rootRect.h)) add({ scope, text: '[область]', kind: 'root', element: 'root', prop: 'root-height', live: `${live.rootRect.h}px`, local: `${local.rootRect.h}px` });
  if (!near(live.rootRect.w, local.rootRect.w)) add({ scope, text: '[область]', kind: 'root', element: 'root', prop: 'root-width', live: `${live.rootRect.w}px`, local: `${local.rootRect.w}px` });
}

function compareRecords(lr, cr, route, width, add, unmatched) {
  const ids = lr.map((r) => r.id);
  const byId = new Map(cr.map((r) => [r.id, r]));
  const bounds = (rec, matchIds) => {
    let list;
    if (rec.nodes.length) { list = rec.nodes.filter((n) => matchIds.some((id) => id.startsWith(n.id) || n.id.startsWith(id))); } else list = rec.leaves;
    if (!list.length) return null;
    return { top: Math.min(...list.map((x) => x.top)), bottom: Math.max(...list.map((x) => x.bottom)) };
  };
  let prevL = null; let prevC = null; let idx = 0;
  for (const l of lr) {
    const c = byId.get(l.id);
    if (!c) { unmatched.push({ scope: 'records', route, width, side: 'запись только на живом', text: l.id, note: `высота ${l.height}` }); continue; }
    idx++;
    const base = { scope: 'records', text: `запись ${l.id}${idx === 1 ? ' (первая)' : ''}`, kind: 'record', element: l.id, first: idx === 1 };
    const cmp = (prop, x, y, tol = TOL) => { if (!near(x, y, tol)) add({ ...base, prop, live: `${r2(x)}px`, local: `${r2(y)}px` }); };
    cmp('padding-top', l.pt, c.pt); cmp('padding-bottom', l.pb, c.pb); cmp('margin-top', l.mt, c.mt); cmp('margin-bottom', l.mb, c.mb);
    cmp('height', l.height, c.height);
    // общие узлы для обеих сторон
    const common = l.nodes.map((n) => n.id).filter((id) => c.nodes.some((n) => id.startsWith(n.id) || n.id.startsWith(id)));
    const bl = bounds(l, common); const bc = bounds(c, common);
    if (bl && bc) {
      cmp('content-inset-top', bl.top, bc.top); cmp('content-inset-bottom', l.height - bl.bottom, c.height - bc.bottom);
      if (prevL && prevC && prevL.b && prevC.b) cmp('gap-from-previous-content', (l.top + bl.top) - (prevL.rec.top + prevL.b.bottom), (c.top + bc.top) - (prevC.rec.top + prevC.b.bottom));
    }
    if (prevL) cmp('gap-from-previous-record', l.top - (prevL.rec.top + prevL.rec.height), c.top - (prevC.rec.top + prevC.rec.height));
    prevL = { rec: l, b: bl }; prevC = { rec: c, b: bc };
  }
  for (const c of cr) if (!ids.includes(c.id)) unmatched.push({ scope: 'records', route, width, side: 'запись только в переносе', text: c.id, note: `высота ${c.height}` });
}

// ───────── Сознательные решения (не считаются отличиями) ─────────
const DECISIONS = [
  { why: 'юр-документы: колонка ~960, кегль 16/15 по решению', test: (d) => d.scope === 'legal' && /^(font-size|line-height|width|height|lines|gap-above|gap-left|inset-left|inset-right|inner-spacing-left|inner-spacing-right|root-height|root-width|letter-spacing|text-align)$/.test(d.prop) },
  { why: 'кнопка «Что изменилось?» скрыта по решению', test: (d) => /что изменилось/i.test(d.text || '') },
  { why: '/clarity: первый экран и две карточки сдвинуты для центровки', test: (d) => d.route === '/clarity' && d.scope === 'records' && d.first },
  { why: 'правило отступов block-spacing: соседние блоки одного цвета дают один отступ (PROGRESS.md, 50 правил в src/block-spacing.css)', test: (d) => d.scope === 'records' && /^gap-from-previous/.test(d.prop) && parseFloat(d.local) < parseFloat(d.live) && parseFloat(d.local) <= 0.5 + 0 || (d.scope === 'records' && d.prop === 'gap-from-previous-content' && parseFloat(d.local) < parseFloat(d.live) - 15) },
  { why: '/mini: контент заменён, сверка записей по высоте/полям неприменима', test: (d) => d.route === '/mini' && d.scope === 'records' && /content-inset|gap-from-previous|height/.test(d.prop) },
];
const decisionOf = (d) => DECISIONS.find((x) => x.test(d))?.why || null;

// ───────── Запуск ─────────
// По умолчанию переносом считается опубликованное превью (адреса со слэшем на конце); --dist сравнивает с локальной сборкой dist (она может отставать от src)
const PREVIEW = 'https://elenasamanchuk.github.io/sistemayasnosti-site';
const useDist = 'dist' in args;
const server = useDist ? await startPreview(0) : null;
const ORIGIN = useDist ? `http://127.0.0.1:${server.address().port}` : (args.local || PREVIEW).replace(/\/$/, '');
const localUrl = (route) => (useDist ? ORIGIN + route : ORIGIN + (route === '/' ? '/' : route + '/'));
const browser = await chromium.launch({ headless: true }).catch((e) => { server?.close(); throw e; });
const dump = []; const diffs = []; const expected = []; const unmatched = []; const failed = []; const coverage = {}; let compared = 0;
try {
  for (const route of routes) {
    const wanted = PLAN[route].filter((s) => !only || only.includes(s));
    if (!wanted.length) continue;
    for (const width of WIDTHS) {
      const names = wanted.filter((s) => !(SCOPES[s]?.phoneOnly && width > 640));
      if (!names.length) continue;
      let L; let C;
      try { L = await snapshot(browser, 'live', LIVE + route, width, names); } catch (e) { failed.push({ route, width, side: 'live', error: String(e.message).split('\n')[0] }); continue; }
      try { C = await snapshot(browser, 'local', localUrl(route), width, names); } catch (e) { failed.push({ route, width, side: 'local', error: String(e.message).split('\n')[0] }); continue; }
      if (args.dump) dump.push({ route, width, live: L, local: C });
      const add = (d) => { const full = { route, width, ...d }; const why = decisionOf(full); (why ? expected : diffs).push(why ? { ...full, decision: why } : full); };
      for (const name of names) {
        coverage[name] = coverage[name] || new Set(); coverage[name].add(`${route}@${width}`);
        if (name === 'buttons') {
          const { pairs, onlyA, onlyB } = pairUp(L.buttons, C.buttons);
          for (const [a, b] of pairs) { compared++; compareItem('buttons', a, b, add); }
          for (const it of onlyA) if (!/to main content/i.test(it.text)) unmatched.push({ scope: name, route, width, side: 'только на живом', text: it.text });
          for (const it of onlyB) unmatched.push({ scope: name, route, width, side: 'только в переносе', text: it.text });
          continue;
        }
        if (name === 'records') { compareRecords(L.records, C.records, route, width, add, unmatched); compared += L.records.length; continue; }
        if (name === 'nav-open' && L.openButtons && C.openButtons) { const pb = pairUp(L.openButtons, C.openButtons); for (const [a, b] of pb.pairs) { compared++; compareItem('nav-open', a, b, add); } }
        const ls = L.scopes[name]; const cs = C.scopes[name];
        if (!ls || !cs) { failed.push({ route, width, side: !ls && !cs ? 'обе' : !ls ? 'live' : 'local', error: `область ${name} не найдена или скрыта` }); continue; }
        const { pairs, onlyA, onlyB } = pairUp(ls.items, cs.items);
        for (const [a, b] of pairs) { compared++; compareItem(name, a, b, add); }
        neighbourGaps(pairs, add, name); insetCheck(ls, cs, pairs, add, name);
        const skipUn = (t) => /что изменилось|to main content/i.test(t || '');
        for (const it of onlyA) if (it.kind !== 'box' && !skipUn(it.text)) unmatched.push({ scope: name, route, width, side: 'только на живом', text: it.text, kind: it.kind });
        for (const it of onlyB) if (it.kind !== 'box' && !skipUn(it.text)) unmatched.push({ scope: name, route, width, side: 'только в переносе', text: it.text, kind: it.kind });
      }
      process.stdout.write(`${route}@${width}: [${names.join(',')}] отличий ${diffs.length}, по решению ${expected.length}\n`);
    }
  }
} finally { await browser.close(); server?.close(); }

// Сводка: одинаковые отличия на разных ширинах склеиваем; сортировка от заметных к мелким
const agg = (list) => {
  const m = new Map();
  for (const d of list) {
    const k = [d.route, d.scope, d.text, d.prop, d.live, d.local].join('\u0001');
    if (!m.has(k)) m.set(k, { route: d.route, scope: d.scope, text: d.text, element: d.element, prop: d.prop, live: d.live, local: d.local, decision: d.decision, widths: [] });
    m.get(k).widths.push(d.width);
  }
  return [...m.values()];
};
const magnitude = (g) => { const x = parseFloat(g.live); const y = parseFloat(g.local); return Number.isFinite(x) && Number.isFinite(y) && /px/.test(g.live + g.local) ? Math.abs(x - y) : 0.5; };
const weight = (g) => (/^(inner-spacing|padding|margin|gap|height|width|size|position|root|content-inset|gap-from|inset)/.test(g.prop) ? 0 : /^(border|box-shadow|background)/.test(g.prop) ? 1 : /^(font|line|letter|text|color)/.test(g.prop) ? 2 : 3);
const grouped = agg(diffs).sort((a, b) => weight(a) - weight(b) || magnitude(b) - magnitude(a) || b.widths.length - a.widths.length);
const report = {
  generatedAt: new Date().toISOString(), live: LIVE, local: useDist ? 'dist (локальный предпросмотр)' : ORIGIN, widths: WIDTHS, routes, tolerancePx: TOL,
  totals: { comparisons: compared, diffs: diffs.length, groupedDiffs: grouped.length, expectedByDecision: expected.length, unmatched: unmatched.length, failed: failed.length },
  coverage: Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, [...v]])),
  grouped, expected: agg(expected), unmatched, failed, diffs,
};
if (args.dump) fs.writeFileSync(args.dump, JSON.stringify(dump));
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync(args.out || 'docs/compare-spacing.json', JSON.stringify(report, null, 1));
console.log(`\nСравнений: ${compared}, отличий: ${diffs.length} (групп ${grouped.length}), по сознательным решениям: ${expected.length}, без пары: ${unmatched.length}, не открылось: ${failed.length}`);
for (const g of grouped.slice(0, 60)) console.log(`${g.route} [${g.scope}] «${String(g.text).slice(0, 40)}» ${g.prop}: ${g.live} → ${g.local} [${g.widths.join(',')}]`);
if (failed.length) console.log('Не открылись/не найдены:', JSON.stringify(failed));
console.log(`Отчёт: ${args.out || 'docs/compare-spacing.json'}`);
process.exit(diffs.length ? 1 : 0);
