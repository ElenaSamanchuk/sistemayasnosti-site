#!/usr/bin/env node
// Единые отступы на телефоне (решение Елены 10.11.2026), макет 320, экраны до 479 px. Без ИИ.
//   node tools/mobile-rhythm.mjs [--url адрес]           замерить без правил и записать src/mobile-rhythm.css
//   node tools/mobile-rhythm.mjs --check [--url адрес]   проверить выложенный сайт, при расхождении код 1
// Шкала, единицы дизайна:
//   соседние блоки одного цвета: между контентом 40; заголовок и его содержимое: 24; карточки мини-курсов: 24
//   разные цвета: 40 у каждого блока (правило: разные цвета складываются), подвал свой отступ сохраняет
//   белая карточка без фото: поля внутри сверху и снизу равны
// Первый экран страницы (высота от окна) и подвал не меняем.
import fs from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const check = args.includes('--check');
const BASE = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'https://preview.sistemayasnosti.com';
const OUTPUT = 'src/mobile-rhythm.css';
const ROUTES = ['/', '/clarity/', '/mini/', '/about/', '/taplink/'];
const SECTION = 40, HEAD = 24, CARDS = 24, TOL = 3;
const HEAD_MAX = 110; // блок ниже этой высоты содержит только заголовок
const CARD_STACK = new Set(['1700529763', '1703000063', '1702980233']);
const FOOTER = new Set(['1580656743', '1491047383']);
const COOKIE = new Set(['2019388833', '2019385873']);

const near = (a, b) => { const p = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number); const x = p(a), y = p(b); return x.length === 3 && y.length === 3 && x.reduce((n, v, i) => n + Math.abs(v - y[i]), 0) <= 6; };

function collect() {
  const out = [];
  for (const s of document.querySelectorAll('.scene-section')) {
    if (!s.getClientRects().length) continue;
    const S = s.getBoundingClientRect();
    if (S.height < 20) continue;
    const nodes = [...s.querySelectorAll('[data-node]')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map((e) => {
      const q = e.getBoundingClientRect(), a = e.querySelector(':scope>.tn-atom') || e, c = getComputedStyle(a);
      // Внутри групп элементы идут потоком, margin там суммируется: для них top, для абсолютных margin-top
      return { n: e.dataset.node, flow: getComputedStyle(e).position !== 'absolute', y: q.top - S.top, b: q.bottom - S.top, x: q.left, r: q.right, w: q.width, h: q.height, group: !!e.querySelector('[data-node]'), bg: c.backgroundColor, img: c.backgroundImage !== 'none', kind: [...e.classList].find((k) => /^scene-(text|shape|image|video|button|vector)/.test(k))?.slice(6) || 'g' };
    }).filter((n) => n.w > 6 && n.h > 4 && n.y >= -2 && n.b <= S.height + 2);
    const leaf = nodes.filter((n) => !n.group);
    if (!leaf.length) continue;
    const y0 = Math.min(...leaf.map((n) => n.y)), y1 = Math.max(...leaf.map((n) => n.b));
    const cards = leaf.filter((n) => n.kind === 'shape' && n.h >= 50 && n.w >= 170 && !n.img && n.bg !== 'rgba(0, 0, 0, 0)').map((k) => {
      const within = leaf.filter((n) => n !== k && n.y >= k.y - 1 && n.b <= k.b + 1 && n.x >= k.x - 1 && n.r <= k.r + 1);
      const text = within.filter((n) => n.kind !== 'shape' && !n.img);
      const pic = within.filter((n) => n.img || n.kind === 'image' || n.kind === 'video');
      if (!text.length) return null;
      // Текст, вылезающий за карточку, не считается внутренним: такую карточку не двигаем, иначе разъедутся строки
      const partial = leaf.some((n) => n !== k && n.kind !== 'shape' && !n.img && !within.includes(n) && n.y < k.b && n.b > k.y && n.x < k.r && n.r > k.x);
      if (partial) return null;
      return { n: k.n, top: Math.min(...text.map((n) => n.y)) - k.y, bot: k.b - Math.max(...text.map((n) => n.b)), pic: pic.length, inside: within.map((n) => `${n.flow ? 't' : 'm'}:${n.n}`) };
    }).filter(Boolean);
    const words = leaf.filter((n) => n.kind === 'text' || n.kind === 'button');
    const overlaps = [];
    for (const p of words) for (const q of words) if (p.n < q.n && Math.min(p.b, q.b) - Math.max(p.y, q.y) > 3 && Math.min(p.r, q.r) - Math.max(p.x, q.x) > 10) overlaps.push(`${p.n}|${q.n}`);
    out.push({ overlaps, id: s.dataset.scene, top: S.top + scrollY, h: S.height, bottom: S.bottom + scrollY, pt: y0, pb: S.height - y1, bg: getComputedStyle(s.querySelector('.scene-canvas')).backgroundColor, mt: parseFloat(getComputedStyle(s).marginTop) || 0, leaf: leaf.map((n) => [n.n, n.y, n.b]), scroll: !!s.querySelector('.scene-canvas--scrollable'), cards });
  }
  return out;
}

async function measure(off) {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, isMobile: true, hasTouch: true });
  const result = {};
  for (const route of ROUTES) {
    const page = await context.newPage();
    await page.goto(`${BASE}${route}?r=${Date.now()}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1500);
    if (off) await page.evaluate(() => document.documentElement.classList.add('no-rhythm'));
    await page.evaluate(async () => { for (let i = 0; i < document.body.scrollHeight; i += 500) { scrollTo(0, i); await new Promise((r) => setTimeout(r, 50)); } scrollTo(0, 0); });
    await page.waitForTimeout(500);
    result[route] = await page.evaluate(collect);
    await page.close();
  }
  await browser.close();
  return result;
}

const skip = (s) => COOKIE.has(s.id);
const targetGap = (a, b) => (a.h <= HEAD_MAX ? HEAD : CARD_STACK.has(a.id) && CARD_STACK.has(b.id) ? CARDS : SECTION);

function plan(pages) {
  const scenes = new Map(), nodes = new Map();
  for (const [route, all] of Object.entries(pages)) {
    const list = all.filter((s) => !skip(s));
    for (const b of list) {
      const own = new Map();
      for (const c of b.cards) {
        if (c.pic) continue; // в карточке с фото поля задаёт картинка
        if (Math.abs(c.top - c.bot) < 4 || Math.abs(c.top - c.bot) > 40) continue; // больше 40: часть карточки занята фото
        const shift = Math.round((c.bot - c.top) / 2);
        for (const n of c.inside) { const key = `${b.id}|${n}`; nodes.set(key, (nodes.get(key) || 0) + shift); own.set(n.split(':')[1], (own.get(n.split(':')[1]) || 0) + shift); }
      }
      // Сдвиг внутри карточки меняет поля самого блока: считаем стыки уже от новых положений
      if (own.size) { b.pt = Math.min(...b.leaf.map(([n, y]) => y + (own.get(n) || 0))); b.pb = b.h - Math.max(...b.leaf.map(([n, , e]) => e + (own.get(n) || 0))); }
    }
    list.forEach((b, i) => {
      if (!i) return;
      const a = list[i - 1];
      if (route === '/' && i === 1) return; // под видео первого экрана своя высота
      const A = scenes.get(a.id) || {}, B = scenes.get(b.id) || {};
      if (FOOTER.has(b.id)) { if (i - 1 > 0) A.dh = (A.dh || 0) + SECTION - a.pb; scenes.set(a.id, { ...A, h0: a.h }); return; }
      const spacer = b.top - a.bottom - b.mt;
      if (near(a.bg, b.bg)) {
        const delta = targetGap(a, b) - a.pb - spacer - b.pt;
        if (delta <= 0) {
          // Следующий блок непрозрачный: наезжать можно только на пустое поле предыдущего, остальное убираем сдвигом его контента
          const room = Math.max(0, a.pb) + Math.max(0, spacer);
          const pull = Math.min(-delta, room), rest = -delta - pull;
          B.mt = -pull;
          if (rest >= 1) { B.shift = -rest; B.dh = (B.dh || 0) - rest; }
        } else if (i - 1 === 0) B.mt = 0;
        else { A.dh = (A.dh || 0) + delta; A.h0 = a.h; B.mt = 0; }
        B.h0 = b.h;
      } else {
        B.mt = 0; B.h0 = b.h;
        if (i - 1 > 0) { A.dh = (A.dh || 0) + SECTION - a.pb; A.h0 = a.h; }
        if (Math.round(SECTION - b.pt)) { B.shift = SECTION - b.pt; B.dh = (B.dh || 0) + B.shift; }
      }
      scenes.set(a.id, { ...A, bg: a.bg }); scenes.set(b.id, { ...B, bg: b.bg });
    });
  }
  return { scenes, nodes };
}

function css({ scenes, nodes }) {
  const px = (v) => `calc(${Math.round(v)}px * var(--scene-scale, 1))`;
  const out = ['/* Создано tools/mobile-rhythm.mjs, вручную не менять. Единые отступы на телефоне, решение Елены 10.11.2026. */', '@media screen and (max-width:479px){'];
  for (const [id, s] of [...scenes].sort()) {
    const r = [];
    if (s.mt !== undefined) r.push(`margin-top:${px(s.mt)}`);
    if (s.dh && Math.round(s.dh)) r.push(`height:${px(s.h0 + s.dh)}!important`);
    if ((s.dh && Math.round(s.dh)) || s.shift) r.push(`background-color:${s.bg}`);
    if (r.length) out.push(`html:not(.no-rhythm) #scene-${id}{${r.join(';')}}`);
    if (s.shift && Math.round(s.shift)) out.push(`html:not(.no-rhythm) #scene-${id} .scene-canvas{top:${px(s.shift)}}`);
  }
  for (const [key, shift] of [...nodes].sort()) {
    if (!Math.round(shift)) continue;
    const [scene, node] = key.split('|');
    const [how, id] = node.split(':');
    out.push(`html:not(.no-rhythm) #scene-${scene} [data-node="${id}"]{${how === 't' ? 'top' : 'margin-top'}:${Math.round(shift)}px${how === 't' ? '!important' : ''}}`);
  }
  out.push('}', '');
  return out.join('\n');
}

function verify(pages) {
  let bad = 0, sum = 0;
  for (const [route, all] of Object.entries(pages)) {
    const list = all.filter((s) => !skip(s));
    list.forEach((b, i) => {
      for (const c of b.cards) { if (c.pic || Math.abs(c.top - c.bot) > 40) continue; sum++; if (Math.abs(c.top - c.bot) > 5) { bad++; console.log(`КАРТОЧКА ${route} ${b.id} ${c.n}: сверху ${Math.round(c.top)}, снизу ${Math.round(c.bot)}`); } }
      if (!i || (route === '/' && i === 1)) return;
      const a = list[i - 1];
      sum++;
      if (FOOTER.has(b.id)) { if (i > 1 && Math.abs(a.pb - SECTION) > TOL) { bad++; console.log(`ПОДВАЛ ${route} перед подвалом ${Math.round(a.pb)}, нужно ${SECTION}`); } return; }
      const gap = b.top + b.pt - (a.top + a.h - a.pb);
      if (b.top < a.top + a.h - a.pb - 1) { bad++; console.log(`НАЕЗД ${route} ${b.id} закрывает низ ${a.id} на ${Math.round(a.top + a.h - a.pb - b.top)}`); }
      const need = near(a.bg, b.bg) ? targetGap(a, b) : a.h && (i > 1 ? 2 * SECTION : a.pb + SECTION);
      if (Math.abs(gap - need) > TOL) { bad++; console.log(`СТЫК ${route} ${a.id} → ${b.id}: ${Math.round(gap)}, нужно ${need}`); }
    });
  }
  console.log(`Проверено стыков и карточек: ${sum}, расхождений: ${bad}`);
  return bad;
}

if (check) {
  const on = await measure(false), off = await measure(true);
  let bad = verify(on);
  for (const [route, all] of Object.entries(on)) for (const b of all) {
    const before = new Set(off[route].find((x) => x.id === b.id)?.overlaps || []);
    for (const pair of b.overlaps) if (!before.has(pair)) { bad++; console.log(`НАЛОЖЕНИЕ ТЕКСТА ${route} ${b.id}: ${pair}`); }
  }
  process.exit(bad ? 1 : 0);
}
const { scenes, nodes } = plan(await measure(true));
fs.writeFileSync(OUTPUT, css({ scenes, nodes }));
console.log(`Записано ${OUTPUT}: блоков ${scenes.size}, сдвигов внутри карточек ${nodes.size}`);
