// Сверка стилей текстовых элементов: живая Тильда (эталон) против локальной сборки dist.
// Запуск: nice node tools/compare-live.mjs [--routes=/,/mini] [--widths=1440,390] [--live=https://sistemayasnosti.com]
// Один headless Chromium, страницы по очереди, видео и счётчики не грузятся, на живой сайт только GET, форм нет.
// Код выхода 1, если есть отличия. Отчёт: docs/compare-live.json. Hover не сравнивается; перед замером анимации доводятся до конца.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { startPreview } from './preview-static.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; }));
const LIVE = (args.live || 'https://sistemayasnosti.com').replace(/\/$/, '');
const WIDTHS = (args.widths || '320,360,375,390,412,430,480,600,640,1710,1920,1440,1366,1200,960').split(',').map(Number);
const allRoutes = JSON.parse(fs.readFileSync('public/content/routes.json', 'utf8')).map((r) => r.path);
const routes = args.routes ? args.routes.split(',') : allRoutes;
const unknown = routes.filter((r) => !allRoutes.includes(r));
if (unknown.length) throw new Error(`Неизвестные страницы: ${unknown}`);
const BLOCKED = /yandex|google-analytics|googletagmanager|facebook|vk\.com|mail\.ru|amocrm|kommo|doubleclick|salebot/i;

// Всё, что выполняется в странице: собирает видимые элементы с собственным текстом и их вычисленные стили.
function collect() {
  const norm = (s) => s.replace(/[   ​­]/g, ' ').replace(/[«»“”„"]/g, '"').replace(/[—–−]/g, '-').replace(/\s+/g, '').toLowerCase();
  const eff = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return Math.round(o * 1000) / 1000; };
  const bgKind = (v) => (v === 'none' ? 'none' : v.replace(/url\([^)]*\)/g, 'url()'));
  const items = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH'].includes(el.tagName.toUpperCase())) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    const text = own.map((n) => n.textContent).join(' ');
    const key = norm(text);
    if (!key) continue;
    const cs = getComputedStyle(el); const rect = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || rect.width < 1 || rect.height < 1) continue;
    const frame = el.closest('.tn-atom');
    const a = el.closest('a');
    const kind = el.closest('.tn-atom__button-content, .scene-atom__button-content, .t-btn') ? 'button' : /^H[1-6]$/.test(el.tagName) ? 'heading' : el.closest('nav, [class*=nav]') ? 'menu' : el.closest('footer, [class*=footer]') ? 'footer' : a ? 'link' : 'text';
    const sides = ['top', 'right', 'bottom', 'left'];
    const border = sides.map((s) => (parseFloat(cs[`border${s[0].toUpperCase() + s.slice(1)}Width`]) > 0 && cs[`border${s[0].toUpperCase() + s.slice(1)}Style`] !== 'none' ? `${cs[`border${s[0].toUpperCase() + s.slice(1)}Width`]} ${cs[`border${s[0].toUpperCase() + s.slice(1)}Color`]}` : '0')).join(' | ');
    // Смещение текста в рамке: для кнопок и плашек (рамка или заливка есть у самой рамки)
    let offset = null;
    if (frame) {
      const fcs = getComputedStyle(frame);
      const framed = frame.querySelector('.tn-atom__button-content, .scene-atom__button-content') || parseFloat(fcs.borderTopWidth) > 0 || parseFloat(fcs.borderLeftWidth) > 0 || (fcs.backgroundColor !== 'rgba(0, 0, 0, 0)' && fcs.backgroundColor !== 'transparent') || frame.classList.contains('tn-atom__button-content') || frame.classList.contains('scene-atom__button-content');
      if (framed) {
        const range = document.createRange(); range.selectNodeContents(own[0]);
        const t = range.getBoundingClientRect(); const f = frame.getBoundingClientRect();
        offset = { dx: Math.round((t.left + t.width / 2 - (f.left + f.width / 2)) * 10) / 10, dy: Math.round((t.top + t.height / 2 - (f.top + f.height / 2)) * 10) / 10 };
      }
    }
    // Масштаб блока: css zoom и transform всех предков (Тильда масштабирует блоки на узких экранах)
    let scale = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = getComputedStyle(e); scale *= parseFloat(c.zoom) || 1; if (c.transform !== 'none') { const m = new DOMMatrix(c.transform); scale *= Math.hypot(m.a, m.b) || 1; } }
    const rng = document.createRange(); rng.selectNodeContents(el);
    const lines = new Set([...rng.getClientRects()].filter((q) => q.width > 0.5).map((q) => Math.round(q.top / 3))).size;
    items.push({
      moving: !!el.closest('#rec2426973703'), scale: Math.round(scale * 1000) / 1000, fsOnScreen: Math.round(parseFloat(cs.fontSize) * scale * 100) / 100, lines, clippedX: rect.right > innerWidth + 1 || rect.left < -1,
      key, text: text.replace(/\s+/g, ' ').trim().slice(0, 80), kind, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), href: a?.getAttribute('href') || '',
      styles: {
        color: cs.color, 'background-color': cs.backgroundColor, 'background-image': bgKind(cs.backgroundImage), border,
        'font-weight': cs.fontWeight, 'font-size': cs.fontSize, 'font-family': cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
        'letter-spacing': cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing, 'text-align': cs.textAlign,
        opacity: String(Math.round(parseFloat(cs.opacity) * 1000) / 1000), 'opacity-effective': String(eff(el)),
      },
      offset,
      rect: { left: Math.round((rect.left + scrollX) * 10) / 10, top: Math.round((rect.top + scrollY) * 10) / 10, width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 },
    });
  }
  // Фигуры, картинки и прочие узлы сцены (без своего текста): сопоставляются по числовому id из класса tn-elem__ID
  const nodes = [];
  for (const el of document.body.querySelectorAll('.t396__elem, .scene-node')) {
    const m = /tn-elem__(\d+)/.exec(el.className); if (!m) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 1 || r.height < 1) continue;
    nodes.push({ moving: !!el.closest('#rec2426973703'), id: m[1], first: r.top + scrollY < innerHeight, type: el.querySelector('img,video') ? 'image' : el.querySelector('.tn-atom__button-content, .scene-atom__button-content') ? 'button' : el.querySelector('[class*=text],.tn-atom[field]') && el.textContent.trim() ? 'text' : 'shape', rect: { left: Math.round((r.left + scrollX) * 10) / 10, top: Math.round((r.top + scrollY) * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 } });
  }
  const art = document.querySelector('.t396__artboard, .scene')?.getBoundingClientRect();
  const recs = {}; document.querySelectorAll('[id^=rec]').forEach((e) => { const h = e.getBoundingClientRect().height; if (h > 0 && /^rec\d+$/.test(e.id)) recs[e.id] = Math.round(h * 10) / 10; });
  const meta = { recs, hscroll: document.documentElement.scrollWidth > innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth, scrollbar: innerWidth - document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight, artboard: art ? { left: Math.round(art.left * 10) / 10, top: Math.round((art.top + scrollY) * 10) / 10, width: Math.round(art.width * 10) / 10, height: Math.round(art.height * 10) / 10 } : null };
  return { items, nodes, meta };
}

async function settle(page) {
  const vh = page.viewportSize().height; let h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h + vh; y += Math.floor(vh * 0.7)) { await page.evaluate((t) => window.scrollTo(0, t), y); await page.waitForTimeout(250); h = await page.evaluate(() => document.documentElement.scrollHeight); }
  await page.waitForTimeout(1800);
  // Тильда проявляет часть блоков только когда они ближе к центру окна: подводим к центру всё, что ещё прозрачно
  for (let pass = 0; pass < 2; pass++) {
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.t396__elem, .scene-node')].map((e, i) => { e.dataset.cmpIdx = i; return e; }).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).opacity === '0' && getComputedStyle(e).display !== 'none'; }).map((e) => e.dataset.cmpIdx).slice(0, 80));
    for (const i of hidden) { await page.evaluate((k) => document.querySelector(`[data-cmp-idx="${k}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' }), i); await page.waitForTimeout(350); }
  }
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.querySelectorAll('*').forEach((e) => { if (e.scrollLeft) e.scrollLeft = 0; }); window.scrollTo(0, 0); });
  await page.waitForTimeout(600);
  // Доводим все конечные анимации и переходы до финала; бесконечные пропускаем. Мышь уведена: hover не срабатывает.
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { const t = a.effect?.getComputedTiming?.(); if (t && Number.isFinite(t.endTime)) a.finish(); } catch { /* бесконечная */ } }));
  await page.waitForTimeout(400);
}

async function snapshot(browser, url, width) {
  const context = await browser.newContext(width <= 640 ? { viewport: { width, height: width === 320 ? 693 : width === 360 ? 780 : 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : { viewport: { width, height: width === 1710 ? 1000 : 900 }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => {
    const r = route.request();
    if (r.resourceType() === 'media' || BLOCKED.test(r.url()) || !['GET', 'HEAD'].includes(r.method())) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  try {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await page.goto(url, { waitUntil: 'load', timeout: 45000 }); lastError = null; break; } catch (e) { lastError = e; }
    }
    if (lastError) throw lastError;
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1500);
    await settle(page);
    return await page.evaluate(collect);
  } finally { await context.close(); }
}

const num = (v) => parseFloat(v);
const differs = (prop, a, b) => {
  if (prop === 'opacity' || prop === 'opacity-effective') return Math.abs(num(a) - num(b)) > 0.01;
  if (prop === 'font-size' || prop === 'letter-spacing') return Math.abs(num(a) - num(b)) > 0.05;
  return a !== b;
};

// --local=https://хост/путь: сравнивать с опубликованным превью (страницы со слэшем на конце) вместо локального dist
const server = args.local ? null : await startPreview(0);
const ORIGIN = args.local ? args.local.replace(/\/$/, '') : `http://127.0.0.1:${server.address().port}`;
const localUrl = (route) => (args.local ? ORIGIN + (route === '/' ? '/' : route + '/') : ORIGIN + route);
const browser = await chromium.launch({ headless: true }).catch((e) => { server?.close(); throw e; });
const diffs = []; const unmatched = []; const failed = []; let compared = 0; let pairs = 0; const checked = [];
const buttonProbe = []; const metas = [];
try {
  for (const route of routes) {
    for (const width of WIDTHS) {
      let live; let local; let liveSnap; let localSnap;
      try { liveSnap = await snapshot(browser, LIVE + route, width); live = liveSnap.items; } catch (e) { failed.push({ route, width, side: 'live', error: String(e.message).split('\n')[0] }); continue; }
      try { localSnap = await snapshot(browser, localUrl(route), width); local = localSnap.items; } catch (e) { failed.push({ route, width, side: 'local', error: String(e.message).split('\n')[0] }); continue; }
      checked.push(`${route}@${width}`);
      const group = (list) => { const m = new Map(); for (const it of list) { if (!m.has(it.key)) m.set(it.key, []); m.get(it.key).push(it); } return m; };
      const gl = group(live); const gc = group(local);
      for (const key of new Set([...gl.keys(), ...gc.keys()])) {
        const a = gl.get(key) || []; const b = gc.get(key) || [];
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) {
          pairs++;
          const base = { route, width, text: a[i].text, kind: a[i].kind, href: a[i].href, nth: `${i + 1}/${a.length}` };
          for (const prop of Object.keys(a[i].styles)) {
            compared++;
            const lv = a[i].styles[prop]; const cv = b[i].styles[prop];
            if (differs(prop, lv, cv)) diffs.push({ ...base, prop, live: lv, local: cv, element: `${b[i].tag}.${b[i].cls}` });
          }
          for (const [prop, av, bv, tol] of [['font-size-onscreen', a[i].fsOnScreen, b[i].fsOnScreen, 0.5], ['scale', a[i].scale, b[i].scale, 0.003], ['lines', a[i].lines, b[i].lines, 0]]) {
            compared++;
            if (Math.abs(av - bv) > tol) diffs.push({ ...base, prop, live: String(av), local: String(bv), element: `${b[i].tag}.${b[i].cls}` });
          }
          compared++;
          if (!a[i].moving && a[i].clippedX !== b[i].clippedX) diffs.push({ ...base, prop: 'clipped-x', live: String(a[i].clippedX), local: String(b[i].clippedX), element: `${b[i].tag}.${b[i].cls}` });
          for (const k of ['left', 'top', 'width', 'height']) {
            compared++;
            if (!(a[i].moving && k === 'left') && Math.abs(a[i].rect[k] - b[i].rect[k]) > 2) diffs.push({ ...base, prop: `pos-${k}`, live: `${a[i].rect[k]}px`, local: `${b[i].rect[k]}px`, element: `${b[i].tag}.${b[i].cls}` });
          }
          if (a[i].offset && b[i].offset) {
            for (const axis of ['dx', 'dy']) {
              compared++;
              if (Math.abs(a[i].offset[axis] - b[i].offset[axis]) > 1) diffs.push({ ...base, prop: axis === 'dy' ? 'text-offset-vertical' : 'text-offset-horizontal', live: `${a[i].offset[axis]}px`, local: `${b[i].offset[axis]}px`, element: `${b[i].tag}.${b[i].cls}` });
            }
          } else if (!!a[i].offset !== !!b[i].offset) {
            unmatched.push({ route, width, side: 'рамка', text: a[i].text, note: `рамка кнопки/плашки есть только ${a[i].offset ? 'на живом' : 'в переносе'}` });
          }
          if (/tribute/i.test(key)) buttonProbe.push({ route, width, color: [a[i].styles.color, b[i].styles.color], weight: [a[i].styles['font-weight'], b[i].styles['font-weight']] });
        }
        if (a.length > n) for (const it of a.slice(n)) unmatched.push({ route, width, side: 'только на живом', text: it.text, kind: it.kind });
        if (b.length > n) for (const it of b.slice(n)) unmatched.push({ route, width, side: 'только в переносе', text: it.text, kind: it.kind });
      }
      metas.push({ route, width, live: liveSnap.meta, local: localSnap.meta });
      const pg = (prop, lv, cv, tol = 2) => { compared++; if (typeof lv === 'boolean' ? lv !== cv : Math.abs(lv - cv) > tol) diffs.push({ route, width, text: '[страница]', kind: 'page', prop, live: String(lv), local: String(cv), nth: '1/1', element: 'page' }); };
      pg('page-height', liveSnap.meta.scrollHeight, localSnap.meta.scrollHeight); pg('horizontal-scroll', liveSnap.meta.hscroll, localSnap.meta.hscroll);
      for (const id of new Set([...Object.keys(liveSnap.meta.recs), ...Object.keys(localSnap.meta.recs)])) {
        const lh = liveSnap.meta.recs[id]; const ch = localSnap.meta.recs[id];
        if (lh == null || ch == null) { unmatched.push({ route, width, side: lh == null ? 'блок только в переносе' : 'блок только на живом', text: `#${id}`, note: `высота ${lh ?? ch}` }); continue; }
        compared++; if (Math.abs(lh - ch) > 2) diffs.push({ route, width, text: `[блок #${id}]`, kind: 'block', prop: 'block-height', live: `${lh}px`, local: `${ch}px`, nth: '1/1', element: id });
      }
      const used = new Set();
      for (const ln of liveSnap.nodes) {
        const j = localSnap.nodes.findIndex((c, idx) => !used.has(idx) && (ln.id.startsWith(c.id) || c.id.startsWith(ln.id)));
        if (j < 0) { unmatched.push({ route, width, side: 'узел только на живом', text: `${ln.type} #${ln.id}`, first: ln.first }); continue; }
        used.add(j); const c = localSnap.nodes[j]; pairs++;
        for (const k of ['left', 'top', 'width', 'height']) {
          compared++;
          if (!(ln.moving && k === 'left') && Math.abs(ln.rect[k] - c.rect[k]) > 2) diffs.push({ route, width, text: `${ln.type} #${c.id}${ln.first ? ' (первый экран)' : ''}`, kind: ln.type, first: ln.first, prop: `pos-${k}`, live: `${ln.rect[k]}px`, local: `${c.rect[k]}px`, nth: '1/1', element: 'node' });
        }
      }
      localSnap.nodes.forEach((c, idx) => { if (!used.has(idx)) unmatched.push({ route, width, side: 'узел только в переносе', text: `${c.type} #${c.id}`, first: c.first }); });
      process.stdout.write(`${route}@${width}: пар ${pairs}, отличий ${diffs.length}\n`);
    }
  }
} finally { await browser.close(); server?.close(); }

// Сводка: одинаковые отличия на разных ширинах склеиваем
const agg = new Map();
for (const d of diffs) {
  const k = [d.route, d.text, d.prop, d.live, d.local, d.nth].join('\u0001');
  if (!agg.has(k)) agg.set(k, { route: d.route, text: d.text, kind: d.kind, element: d.element, prop: d.prop, live: d.live, local: d.local, nth: d.nth, widths: [] });
  agg.get(k).widths.push(d.width);
}
const grouped = [...agg.values()];
const weight = (g) => (/^(block-height|page-height|horizontal-scroll|font-size-onscreen|scale|lines|clipped-x)$/.test(g.prop) ? -1 : /^pos-/.test(g.prop) ? 5 : /color|opacity/.test(g.prop) && g.prop !== 'border' ? 0 : g.prop === 'font-weight' ? 1 : g.prop === 'background-color' || g.prop === 'background-image' || g.prop === 'border' ? 2 : /offset/.test(g.prop) ? 4 : 3);
grouped.sort((a, b) => weight(a) - weight(b) || a.route.localeCompare(b.route));
const report = {
  generatedAt: new Date().toISOString(), live: LIVE, widths: WIDTHS, routes,
  totals: { pagesChecked: checked.length, pairs, comparisons: compared, diffs: diffs.length, groupedDiffs: grouped.length, unmatched: unmatched.length, failed: failed.length },
  tributeProbe: buttonProbe, metas, grouped, diffs, unmatched, failed,
};
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync(args.out || 'docs/compare-live.json', JSON.stringify(report, null, 1));
console.log(`\nСтраниц×ширин: ${checked.length}, пар элементов: ${pairs}, сравнений: ${compared}, отличий: ${diffs.length} (групп ${grouped.length}), без пары: ${unmatched.length}, не открылось: ${failed.length}`);
const tr = buttonProbe.filter((p) => p.width === 1440);
for (const p of tr) console.log(`Tribute ${p.route}: цвет ${p.color[0]} → ${p.color[1]}${p.color[0] === p.color[1] ? ' (совпал)' : ''}`);
for (const g of grouped.slice(0, 40)) console.log(`${g.route} «${g.text}» ${g.prop}: ${g.live} → ${g.local} [${g.widths.join(',')}]`);
const hero = diffs.filter((d) => d.route === '/' && d.first && d.kind !== 'text' && /^pos-(left|top)$/.test(d.prop));
const byW = new Map(); for (const d of hero) { if (!byW.has(d.width)) byW.set(d.width, []); byW.get(d.width).push(d); }
console.log('\nПоложение фигур/картинок первого экрана на /:');
for (const w of WIDTHS) { const m = metas.find((x) => x.route === '/' && x.width === w); const list = byW.get(w) || []; const shifts = list.map((d) => `${d.text} ${d.prop} ${d.live}→${d.local}`);
  console.log(`  ${w}: полоса прокрутки live/перенос ${m?.live.scrollbar}/${m?.local.scrollbar}, холст ${JSON.stringify(m?.live.artboard)} → ${JSON.stringify(m?.local.artboard)}; сдвигов ${list.length}${shifts.length ? ': ' + shifts.slice(0, 4).join('; ') : ''}`); }
if (failed.length) console.log('Не открылись:', JSON.stringify(failed));
console.log(`Отчёт: ${args.out || 'docs/compare-live.json'}`);
process.exit(diffs.length ? 1 : 0);
