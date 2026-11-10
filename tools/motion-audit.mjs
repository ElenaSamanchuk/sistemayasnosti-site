// Плавность ховеров, открытий и закрытий: ищет изменения, которые происходят скачком за один кадр.
// Запуск: node tools/motion-audit.mjs (нужен собранный dist). Код 1, если есть скачки. Внешние запросы блокируются, ничего не отправляется.
import { pathToFileURL } from 'node:url';
import { startPreview, PREVIEW_PORT } from './preview-static.mjs';

const playwrightPath = process.env.PLAYWRIGHT_PATH || 'playwright';
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const origin = `http://127.0.0.1:${PREVIEW_PORT}`;
const pages = ['/', '/taplink', '/clarity', '/mini', '/about', '/audio-club', '/cookie'];
const server = await startPreview();
const browser = await chromium.launch({ headless: true });
const jumps = [];
const passed = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const installSampler = () => {
  const PROPS = ['color', 'backgroundColor', 'borderTopColor', 'boxShadow', 'opacity', 'transform', 'filter', 'stroke', 'fill'];
  window.__snap = (el) => {
    const out = {};
    const nodes = [el, ...[...el.querySelectorAll('*')].slice(0, 8)];
    nodes.forEach((node, i) => {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(node, pseudo);
        if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
        for (const p of PROPS) out[`${i}${pseudo || ''}.${p}`] = cs[p];
      }
    });
    return out;
  };
  window.__record = (el, ms) => new Promise((resolve) => {
    const frames = [window.__snap(el)];
    const end = performance.now() + ms;
    const tick = () => { frames.push(window.__snap(el)); if (performance.now() < end) requestAnimationFrame(tick); else resolve(frames); };
    requestAnimationFrame(tick);
  });
};
// Свойство, изменившееся без единого промежуточного значения, считается скачком
function stepProps(frames) {
  const first = frames[0], last = frames[frames.length - 1], out = [];
  for (const key of Object.keys(first)) {
    if (first[key] === last[key]) continue;
    const distinct = new Set(frames.map((f) => f[key]));
    if (key.endsWith('::before.transform') && distinct.size <= 2 && last[key].endsWith(', 0, 0)')) continue; // блик .light после ухода за границей кнопки, возврат не виден
    if (distinct.size <= 2) out.push(`${key}: ${first[key]} -> ${last[key]}`);
  }
  return out;
}
const blockExternal = (context) => context.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
async function acceptCookies(page) {
  const accept = page.getByText('Согласен', { exact: true }).first();
  if (await accept.isVisible().catch(() => false)) { await accept.click(); await pause(600); }
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockExternal(desktop);
  const page = await desktop.newPage();
  await page.addInitScript(installSampler);
  const seen = new Set();
  for (const path of pages) {
    await page.goto(origin + path, { waitUntil: 'load' });
    await pause(1200);
    await acceptCookies(page);
    const handles = await page.$$('a, button, .light');
    for (const handle of handles) {
      const info = await handle.evaluate((el) => { const r = el.getBoundingClientRect(); return { box: r.width > 8 && r.height > 8 && getComputedStyle(el).visibility !== 'hidden', sig: `${el.tagName}.${[...el.classList].filter((c) => !/^tn-elem__|^js-/.test(c)).slice(0, 4).join('.')}|${el.closest('[data-node]') ? getComputedStyle(el).color : ''}` }; }).catch(() => null);
      if (!info?.box || seen.has(info.sig)) continue;
      seen.add(info.sig);
      try {
        await handle.scrollIntoViewIfNeeded({ timeout: 1500 });
        await pause(900);
        const b = await handle.boundingBox();
        if (!b) continue;
        await page.mouse.move(2, 2); await pause(350);
        const hit = await page.evaluate(([x, y]) => { const t = document.elementFromPoint(x, y); return !!t; }, [b.x + b.width / 2, b.y + b.height / 2]);
        if (!hit) continue;
        for (const phase of ['наведение', 'уход']) {
          const recording = handle.evaluate((el) => window.__record(el, 1300));
          await pause(60);
          if (phase === 'наведение') await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); else await page.mouse.move(2, 2);
          const steps = stepProps(await recording);
          if (steps.length) jumps.push({ where: path, what: info.sig.split('|')[0], phase, steps: steps.slice(0, 3) });
          else passed.push(`${phase} ${info.sig.split('|')[0]}`);
        }
      } catch { /* элемент исчез или перекрыт, не считается результатом */ }
    }
  }
  await desktop.close();

  // Появление и исчезновение: первый кадр после появления не должен быть уже полностью видимым, исчезновение не должно обрываться
  const presence = async (page, selector, name, show, hide) => {
    const watch = () => page.evaluate((sel) => new Promise((resolve) => {
      const out = []; const end = performance.now() + 1400;
      const tick = () => { const el = document.querySelector(sel); out.push(el ? Number(getComputedStyle(el).opacity) * (el.getBoundingClientRect().height ? 1 : 0) : -1); if (performance.now() < end) requestAnimationFrame(tick); else resolve(out); };
      requestAnimationFrame(tick);
    }), selector);
    for (const [phase, act] of [['появление', show], ['исчезновение', hide]]) {
      if (!act) continue;
      const rec = watch(); await pause(80); await act(); const values = await rec;
      const partial = values.filter((v) => v > 0.02 && v < 0.98).length;
      if (partial === 0) jumps.push({ where: name, what: selector, phase, steps: ['скачком, без промежуточной прозрачности'] });
      else passed.push(`${phase} ${name} (${partial} кадров)`);
      await pause(500);
    }
  };
  for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, hasTouch: label === '390' });
    await blockExternal(context);
    const p = await context.newPage();
    await p.goto(`${origin}/`, { waitUntil: 'load' }); await pause(1500);
    await presence(p, '.cookieBanner', `плашка куки ${label}`, null, () => p.getByText('Согласен', { exact: true }).first().click());
    if (label === '390') await presence(p, '.site-nav', 'мобильное меню', () => p.locator('.site-burger').click(), () => p.locator('.site-burger').click());
    await presence(p, '.back-top', `стрелка «Наверх» ${label}`, () => p.evaluate(() => scrollTo({ top: innerHeight * 2, behavior: 'instant' })), () => p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })));
    await p.goto(`${origin}/taplink`, { waitUntil: 'load' }); await pause(1200); await acceptCookies(p);
    const openPopup = () => p.evaluate(() => [...document.querySelectorAll('a[href="#zeropopup"]')].find((x) => x.getClientRects().length).click());
    await presence(p, '.native-modal__bg', `попап ${label}`, openPopup, () => p.locator('.popup-close').first().click());
    await openPopup(); await pause(1000);
    const flag = p.locator('.native-dialog .zero-form__country').first();
    const list = '.native-dialog .zero-form__countries';
    await presence(p, list, `список стран ${label}`, () => flag.click(), () => flag.click());
    await presence(p, '.native-dialog .zero-form__error', `подсказка поля ${label}`, () => p.locator('.native-dialog .zero-form__submit').click(), null);
    await presence(p, '.native-dialog .zero-form__summary', `общая ошибка формы ${label}`, null, async () => { const fields = p.locator('.native-dialog .zero-form__input'); for (let i = 0, n = await fields.count(); i < n; i += 1) await fields.nth(i).fill('1'); });
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
const group = new Map();
for (const j of jumps) { const key = `${j.what} | ${j.phase}`; if (!group.has(key)) group.set(key, { ...j, count: 0 }); group.get(key).count += 1; }
console.log(`Плавных проверок: ${passed.length}. Скачков: ${jumps.length} (разных: ${group.size})`);
for (const g of group.values()) console.log(`СКАЧОК ${g.where} ${g.what} [${g.phase}] x${g.count}: ${g.steps.join('; ')}`);
process.exit(jumps.length ? 1 : 0);
