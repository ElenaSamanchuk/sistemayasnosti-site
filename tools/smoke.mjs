// Проверка собранной статики без ИИ: один браузер без окна, страницы по очереди. Живой сайт не открывается, форм нет.
// Ненулевой код выхода: на всех страницах на 1440 и 390 — ошибки JS, внешние запросы, битые картинки, горизонтальная прокрутка;
// попапы, видео, формы без запросов, анимации и встроенные компоненты проверяются на своих страницах, общий слой — на документах.
// Высота с эталоном для документов не сравнивается (решение Елены 09.11: колонка 960, кегль 16/15), для остальных идёт в отчёт.
import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';
import { startPreview } from './preview-static.mjs';
import { KOMMO, METRIKA_ID, METRIKA_SCRIPT_URL, PRODUCTION_HOSTNAME } from '../src/lib/site-integrations.mjs';
const engine = process.argv[2] || 'chromium';
const browserType = { chromium, firefox, webkit }[engine];
if (!browserType) throw new Error(`Неизвестный движок: ${engine}`);
const DOCS = ['/oferta', '/privacy', '/consent', '/cookie'];
const POPUPS = { '/': { form: true, empty: '#zeropopupmain' }, '/mini': { form: true }, '/taplink': { form: true }, '/about': { form: false } };
const VIDEOS = { '/': { 'html-video-2194603213-176310813087013300': '50% 50%' }, '/mini': { 'html-video-1703875663-1766147559512000013': '36% 50%' }, '/taplink': { 'html-video-1555825513-1763030714627': '50% 50%', 'html-video-1557093663-1763043211874': '36% 50%' } };
const HSCROLL = { '/': ['#rec1487844433'], '/about': ['#rec2098148563'], '/clarity': ['#rec2426973803', '#rec2426973763'] };
const VIEWS = { 1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, 390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } };
// Playwright Firefox не умеет isMobile: телефонная ширина проверяется окном нужной ширины с касанием и DPR 3 (это не эмуляция устройства, а проверка вёрстки движком Firefox)
const FIREFOX_PHONES = { 390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true }, 360: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, hasTouch: true } };
const isPhone = (view) => view !== '1440';
const measures = JSON.parse(fs.readFileSync('sources/live/2026-11-09/reference/measures.json', 'utf8'));
const allRoutes = JSON.parse(fs.readFileSync('public/content/routes.json', 'utf8'));
const requestedRoutes = new Set(process.argv.slice(3));
const routes = requestedRoutes.size ? allRoutes.filter((route) => requestedRoutes.has(route.path)) : allRoutes;
if (requestedRoutes.size && routes.length !== requestedRoutes.size) throw new Error('В смоуке указана неизвестная страница');
const server = await startPreview(0);
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await browserType.launch({ headless: true }).catch((error) => {
  server.close();
  throw error;
});
const results = [];
const safe = (value) => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return '[адрес]'; } };
const inlineResource = (url, origin) => url.startsWith('data:') || url.startsWith(`blob:${origin}/`);
const localRequest = (request) => inlineResource(request.url(), ORIGIN) ||
  (request.url().startsWith(ORIGIN + '/') && ['GET', 'HEAD'].includes(request.method()));
async function settle(page) {
  let h = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = Math.floor(page.viewportSize().height * 0.8);
  for (let y = 0; y < h + step; y += step) { await page.evaluate((top) => window.scrollTo(0, top), y); await page.waitForTimeout(100); h = await page.evaluate(() => document.documentElement.scrollHeight); }
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}
const sleep = (page, ms) => page.waitForTimeout(ms);
const centre = (page, selector) => page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center', behavior: 'instant' }), selector);
// Клик внутри страницы и покадровая запись сдвига окна: так видно, что попап действительно выезжает и уезжает
const samplePopup = (page, opener) => page.evaluate(async (selector) => {
  const shift = () => { const d = document.querySelector('.native-dialog'); return d ? new DOMMatrix(getComputedStyle(d).transform).m42 : null; };
  [...document.querySelectorAll(selector)].filter((x) => x.getClientRects().length)[0].click();
  const started = performance.now(); const samples = [];
  while (performance.now() - started < 1000) { await new Promise(requestAnimationFrame); samples.push(Math.round(shift() ?? -1)); if (samples.at(-1) === -1) break; }
  return { samples, ms: Math.round(performance.now() - started) };
}, opener);
async function popupClosed(page) { await page.waitForFunction(() => !document.querySelector('.native-modal'), null, { timeout: 2000 }); return page.evaluate(() => ({ overflow: document.body.style.overflow, hash: location.hash })); }
async function checkPopups(page, route, result, requests) {
  const spec = POPUPS[route.path]; const fail = (text) => result.problems.push(`попап: ${text}`);
  const link = 'a[href="#zeropopup"]';
  const hasLink = await page.evaluate((s) => [...document.querySelectorAll(s)].some((x) => x.getClientRects().length), link);
  if (!hasLink) return fail('нет видимой ссылки');
  await page.evaluate((s) => [...document.querySelectorAll(s)].find((x) => x.getClientRects().length).scrollIntoView({ block: 'center', behavior: 'instant' }), link); await sleep(page, 1500);
  const open = async () => { const trace = await samplePopup(page, link); await page.waitForSelector('.native-dialog', { timeout: 2000 }); await sleep(page, 700); return trace; };
  const opened = await open();
  result.popup = { opened };
  if (!(opened.samples.find((v) => v > 50) && opened.samples.at(-1) === 0)) fail(`не выезжает снизу: ${opened.samples.slice(0, 5)}…${opened.samples.at(-1)}`);
  const state = await page.evaluate(() => { const bg = document.querySelector('.native-modal__bg'); const rect = document.querySelector('.native-dialog').getBoundingClientRect(); return { blur: getComputedStyle(bg).backdropFilter, overflow: document.body.style.overflow, hash: location.hash, nodes: document.querySelectorAll('.native-dialog .scene-node').length, height: rect.height }; });
  result.popup.state = state;
  if (state.blur !== 'blur(4px)') fail(`фон ${state.blur}`);
  if (state.overflow !== 'hidden' || !state.nodes) fail('окно пустое или страница не заблокирована');
  if (spec.form) await checkForm(page, route, result, requests);
  await centre(page, '.popup-close');
  const closing = await samplePopup(page, '.popup-close');
  result.popup.closing = closing;
  // Промежуточное положение доказывает, что окно движется. Число захваченных кадров зависит от браузера.
  const path = closing.samples.filter((v) => v > 0);
  if (!path.some((v) => v < page.viewportSize().height) || path.some((v, i) => i && v < path[i - 1])) fail(`закрытие не плавное: ${closing.samples.join(',')}`);
  let after = await popupClosed(page);
  if (after.overflow || after.hash) fail('после крестика страница не вернулась');
  await open(); await page.keyboard.press('Escape'); after = await popupClosed(page);
  if (after.overflow || after.hash) fail('Esc не закрыл');
  await open();
  // Точка вне окна: на /about на телефоне карточка занимает почти весь экран, поэтому ищем свободное место
  const outside = await page.evaluate(() => { const w = innerWidth, h = innerHeight; for (const [x, y] of [[3, h / 2], [3, 60], [3, h - 3], [w - 3, h - 3], [w / 2, h - 3], [w - 60, 3]]) { const e = document.elementFromPoint(x, y); if (e && !e.closest('.scene-node,.scene-group,.popup-close')) return [x, y]; } return null; });
  if (!outside) return fail('нет места вне окна для клика');
  await page.mouse.click(outside[0], outside[1]); after = await popupClosed(page);
  if (after.overflow || after.hash) fail('клик вне окна не закрыл');
  if (spec.empty) {
    const empty = await page.evaluate((s) => { const a = [...document.querySelectorAll(`a[href="${s}"]`)].find((x) => x.getClientRects().length && x.textContent.trim()); if (!a) return { found: false }; a.click(); return { found: true, text: a.textContent.trim(), modal: !!document.querySelector('.native-modal'), hash: location.hash }; }, spec.empty);
    await sleep(page, 300);
    const modal = await page.evaluate(() => !!document.querySelector('.native-modal'));
    result.popup.empty = empty;
    if (empty.found || modal || empty.hash) fail('кнопка «Что изменилось?» должна быть скрыта (решение Елены 09.11.2026)');
  }
}
async function checkForm(page, route, result, requests) {
  const fail = (text) => result.problems.push(`форма: ${text}`);
  const fields = page.locator('.native-dialog .zero-form__input');
  const count = await fields.count();
  if (count !== 4) return fail(`полей ${count}, в снимке 4`);
  const started = requests.length;
  await page.locator('.native-dialog .zero-form__submit').click(); await sleep(page, 200);
  const empty = await page.locator('.native-dialog .zero-form__error').count();
  if (empty !== 4) fail(`пустая форма: ошибок ${empty} из 4`);
  await fields.nth(0).fill('Анна Проверка'); await fields.nth(1).pressSequentially('123'); await fields.nth(2).fill('@qa_local'); await fields.nth(3).fill('Локальная проверка');
  await page.locator('.native-dialog .zero-form__submit').click(); await sleep(page, 200);
  const phone = await page.locator('.native-dialog .zero-form__error').allInnerTexts();
  if (phone.length !== 1 || !phone[0].includes('номер телефона')) fail(`короткий телефон: ${phone}`);
  await fields.nth(1).fill(''); await fields.nth(1).pressSequentially('9001234567');
  const masked = await fields.nth(1).inputValue();
  if (masked !== '+7 (900) 123-45-67') fail(`маска телефона ${masked}`);
  // Выбор страны: по умолчанию Россия, список открывается, Испания меняет код и формат, окно остаётся открытым
  const countryBtn = page.locator('.native-dialog .zero-form__country');
  if (!(await countryBtn.getAttribute('aria-label')).includes('Россия')) fail('страна по умолчанию не Россия');
  await countryBtn.click(); await page.locator('.zero-form__option', { hasText: 'Испания' }).click(); await sleep(page, 150);
  await fields.nth(1).fill(''); await fields.nth(1).pressSequentially('600123456');
  const spanish = await fields.nth(1).inputValue();
  if (spanish !== '+34 600 12 34 56') fail(`маска Испании ${spanish}`);
  if (!(await page.evaluate(() => !!document.querySelector('.native-dialog')))) fail('выбор страны закрыл окно');
  await fields.nth(1).fill(''); await fields.nth(1).pressSequentially('+79001234567');
  const back = await fields.nth(1).inputValue();
  if (back !== '+7 (900) 123-45-67' || !(await countryBtn.getAttribute('aria-label')).includes('Россия')) fail(`ввод +7 не вернул Россию: ${back}`);
  await page.locator('.native-dialog .zero-form__submit').click();
  // Вне боевого домена успех изображается (решение Елены 09.11.2026), запросов быть не должно: проверка ниже
  const status = await page.locator('.native-dialog [role=status]').innerText({ timeout: 3000 }).catch(() => '');
  if (!status.includes('Данные успешно отправлены')) fail('нет сообщения об успешной отправке');
  const made = requests.slice(started).filter((r) => r.method !== 'GET' || !r.url.includes('/media/'));
  result.form = { errorsOnEmpty: empty, masked, status: status.split('\n')[0], requests: made.length };
  if (made.length) fail(`ушли запросы: ${made.map((r) => `${r.method} ${safe(r.url)}`).join(', ')}`);
}
async function checkVideos(page, route, result) {
  result.videos = [];
  for (const [id, position] of Object.entries(VIDEOS[route.path])) {
    await centre(page, `#${id}`); await sleep(page, 1500);
    const read = () => page.evaluate((i) => { const v = document.getElementById(i); return v && { paused: v.paused, time: v.currentTime, loop: v.loop, muted: v.muted, width: v.videoWidth, poster: v.getAttribute('poster'), error: v.error?.message || '', position: getComputedStyle(v).objectPosition, src: new URL(v.currentSrc || v.src || '', location.href).origin }; }, id);
    const initial = await read();
    const gestureFallback = initial?.paused && !!initial.poster && !initial.error;
    if (gestureFallback) {
      await page.keyboard.press('a');
      await page.waitForFunction((i) => {
        const video = document.getElementById(i);
        return video && !video.paused && video.videoWidth > 0;
      }, id, { timeout: 5000 }).catch(() => {});
    }
    const first = await read(); await sleep(page, 700); const second = await read();
    result.videos.push({ id, initial, gestureFallback, first, second });
    if (!initial?.poster?.startsWith('/media/')) result.problems.push(`видео ${id}: нет локальной заставки`);
    if (!first || first.paused || !first.loop || !first.muted || first.error || !first.width || !(second.time !== first.time)) result.problems.push(`видео ${id} не играет`);
    else if (first.position !== position) result.problems.push(`видео ${id}: кадр ${first.position}, нужно ${position}`);
    else if (first.src !== ORIGIN) result.problems.push(`видео ${id} не локальное`);
  }
}
async function checkAnimations(page, route, view, result) {
  const timed = async (selector) => {
    await centre(page, selector); await sleep(page, 900);
    const read = () => page.evaluate((s) => { const n = [...document.querySelectorAll(`${s} [data-node]`)].find((x) => x.__sbs); return n ? { transform: getComputedStyle(n.__sbs.target).transform, state: n.__sbs.animation?.playState } : null; }, selector);
    // У кнопки /mini после покачивания пауза 3 с, поэтому смотрим весь цикл
    const seen = new Set(); let last = null;
    for (let i = 0; i < 16; i += 1) { last = await read(); if (last) seen.add(last.transform); await sleep(page, 280); }
    if (!last || last.state !== 'running' || seen.size < 2) result.problems.push(`анимация blockintoview ${selector} не идёт`);
    return { state: last?.state, distinct: seen.size };
  };
  if (route.path === '/mini') result.blockintoview = await timed('#rec1699756153');
  if (route.path === '/clarity') {
    result.blockintoview = await timed('#rec2426973723');
    if (view === '390') {
      const block = await page.evaluate(() => { const r = document.querySelector('#rec2426973813').getBoundingClientRect(); return r.height ? r.top + scrollY : null; });
      if (block === null) result.problems.push('нет блока с закреплением /clarity');
      else {
        await page.evaluate((y) => window.scrollTo(0, y), block + 900); await sleep(page, 500);
        const pinned = await page.evaluate(() => [...document.querySelectorAll('#rec2426973813 [data-node]')].filter((x) => x.__sbs && x.__sbs.target.style.position === 'fixed').length);
        await page.evaluate((y) => window.scrollTo(0, y), block - 900); await sleep(page, 500);
        const released = await page.evaluate(() => [...document.querySelectorAll('#rec2426973813 [data-node]')].filter((x) => x.__sbs && x.__sbs.target.style.position === 'fixed').length);
        result.scrollPin = { pinned, released };
        if (!pinned || released) result.problems.push(`закрепление при прокрутке: ${pinned}/${released}`);
      }
    }
  }
}
async function checkEmbeds(page, route, view, result) {
  for (const selector of HSCROLL[route.path] || []) {
    await centre(page, `${selector} .t396__artboard`); await sleep(page, 400);
    const box = await page.evaluate((s) => { const e = document.querySelector(`${s} .t396__artboard`); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, tagged: e.hasAttribute('data-hscroll'), max: e.scrollWidth - e.clientWidth }; }, selector);
    if (!box.tagged || !(box.max > 0)) { result.problems.push(`лента ${selector} не подключена`); continue; }
    await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x - 150, box.y, { steps: 5 }); await page.mouse.up(); await sleep(page, 100);
    const left = await page.evaluate((s) => document.querySelector(`${s} .t396__artboard`).scrollLeft, selector);
    if (!(left > 100)) result.problems.push(`лента ${selector} не тянется: ${left}`);
    (result.hscroll ||= {})[selector] = left;
  }
  if (route.path === '/clarity') {
    await page.mouse.move(0, 0);
    await centre(page, '#rec2426973703 .t396__artboard'); await sleep(page, 2500);
    const read = () => page.evaluate(() => document.querySelector('#rec2426973703 .t396__artboard').scrollLeft);
    const a = await read(); await sleep(page, 800); const b = await read();
    result.autoscroll = { a, b };
    if (!(b !== a)) result.problems.push('автопрокрутка /clarity стоит');
  }
  if (route.path === '/') {
    const typed = '.tn-elem__1485551813176157991652187570';
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(page, 200);
    await centre(page, typed); await sleep(page, 2500);
    const len = await page.evaluate((s) => document.querySelector(s).textContent.length, typed);
    result.typewriter = len;
    if (!(len > 5)) result.problems.push('печатная машинка не печатает');
    // Фраза допечатывается полностью: сравнение с текстом из HTML страницы (50 мс на букву, длинная фраза идёт около 9 с)
    const full = await page.evaluate(async (s) => { const html = await (await fetch(location.href)).text(); return new DOMParser().parseFromString(html, 'text/html').querySelector(s)?.textContent || ''; }, typed);
    const done = await page.waitForFunction(([s, t]) => document.querySelector(s).textContent === t, [typed, full], { timeout: 20000 }).then(() => true, () => false);
    result.typewriterFull = done;
    if (!full || !done) result.problems.push('печатная машинка не допечатала фразу');
  }
  if (route.path.startsWith('/audio-club')) {
    await page.waitForFunction(() => document.getElementById('sya-club-app')?.children.length > 0, null, { timeout: 8000 }).catch(() => {});
    const club = await page.evaluate(() => ({ size: document.getElementById('sya-club-app')?.innerHTML.length || 0, placed: !!document.querySelector('main #sya-club'), asset: window.SYA_ASSET_BASE }));
    result.club = club;
    if (!club.size || !club.placed) result.problems.push('аудиоклуб не собрался');
    await checkClubOffer(page, route, result);
  }
  const integrations = await page.evaluate(() => window.__syaIntegrations || null);
  if (integrations && (integrations.metrika || integrations.kommo)) result.problems.push('Метрика или Kommo запустились на превью');
}
// Аудиоклуб дорисовывается после load. Прокрутка по всей странице, затем: все блоки раскрылись, нижний блок с ценой виден и ведёт на нужную подписку (ссылка из снимка)
const CLUB_OFFER = { '/audio-club': { id: 's18xT', price: '35 €' }, '/audio-club-old': { id: 's15wd', price: '29 €' }, '/audio-club-old-old': { id: 's18xT', price: '35 €' } };
async function checkClubOffer(page, route, result) {
  const fail = (text) => result.problems.push(`блок цены аудиоклуба: ${text}`);
  const step = Math.floor(page.viewportSize().height * 0.6);
  for (let y = 0; y < await page.evaluate(() => document.documentElement.scrollHeight) + step; y += step) { await page.evaluate((top) => window.scrollTo(0, top), y); await sleep(page, 150); }
  await sleep(page, 1800);
  const hidden = await page.evaluate(() => [...document.querySelectorAll('#sya-club [data-sya-reveal]')].filter((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).opacity === '0').length);
  if (hidden) fail(`не раскрылись элементы: ${hidden}`);
  const spec = CLUB_OFFER[route.path];
  await page.evaluate(() => { const links = [...document.querySelectorAll('#sya-club a[href*="startapp="]')].filter((a) => /Перейти\s+в\s+бот/.test(a.textContent)); links.at(-1)?.scrollIntoView({ block: 'center', behavior: 'instant' }); });
  await sleep(page, 1000);
  const offer = await page.evaluate(() => {
    const a = [...document.querySelectorAll('#sya-club a[href*="startapp="]')].filter((x) => /Перейти\s+в\s+бот/.test(x.textContent)).at(-1);
    if (!a) return null;
    const r = a.getBoundingClientRect(); const section = a.closest('section');
    return { href: a.href, label: a.textContent.trim(), visible: r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && Number(getComputedStyle(a).opacity) === 1 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('a') === a, text: section.innerText.replace(/\s+/g, ' ') };
  });
  if (!offer) return fail('нет кнопки оплаты');
  result.clubOffer = { href: offer.href, label: offer.label, visible: offer.visible, price: offer.text.includes(spec.price) };
  if (!offer.visible) fail('кнопка не видна');
  if (offer.href !== `tg://resolve?domain=tribute&appname=app&startapp=${spec.id}`) fail(`ссылка ${offer.href}, нужно ${spec.id}`);
  if (!offer.text.includes(spec.price)) fail(`нет цены ${spec.price}`);
  if (!/Начни\s+с\s+темы/i.test(offer.text)) fail('нет заголовка блока');
  await page.evaluate(() => window.scrollTo(0, 0));
  const player = page.locator('#sya-club .sya-play:visible').first();
  await player.click({ timeout: 5000 });
  await page.locator('#sya-club[data-sya-playing]').waitFor({ timeout: 5000 });
  const playing = await player.getAttribute('aria-pressed');
  await player.click({ timeout: 4000 });
  const paused = await player.getAttribute('aria-pressed');
  result.clubPlayer = { playing, paused };
  if (playing !== 'true' || paused !== 'false') result.problems.push('аудиоклуб: кнопка не запускает или не останавливает плеер');
}
async function checkShell(page, route, result) {
  const navigation = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('header .site-nav__link')];
    const hrefs = (selector) => [...document.querySelectorAll(selector)].map((a) => a.getAttribute('href'));
    return {
      headers: document.querySelectorAll('header.site-header').length,
      footers: document.querySelectorAll('#app > div > footer').length,
      nav: nav.map((a) => a.getAttribute('href')),
      active: nav.find((a) => a.getAttribute('aria-current') === 'page')?.getAttribute('href'),
      logos: hrefs('header a[aria-label="На главную"]'),
      footer: hrefs('#app > div > footer a[href]'),
      linkIssues: [...document.querySelectorAll('a[href]')].filter((a) => {
        if (!/^https?:$/.test(a.protocol)) return false;
        if (a.origin === location.origin) return a.target === '_blank';
        const rel = a.relList;
        return a.target !== '_blank' || !rel.contains('noopener');
      }).map((a) => a.getAttribute('href')),
    };
  });
  result.shell = navigation;
  const home = route.path === '/' ? '#home' : '/';
  const primary = [home, '/clarity', '/mini', '/audio-club', '/about'];
  if (navigation.headers !== 1 || navigation.logos.length !== 2 || navigation.logos.some((url) => url !== '/') ||
      JSON.stringify(navigation.nav) !== JSON.stringify(primary)) result.problems.push('общая шапка: меню или логотип');
  if (primary.includes(route.path === '/' ? home : route.path) && navigation.active !== (route.path === '/' ? home : route.path)) result.problems.push('общая шапка: активный пункт');
  if (navigation.footers !== 1 || ![...DOCS, '/', '/clarity', '/mini', '/audio-club', '/about'].every((href) => navigation.footer.includes(href))) result.problems.push('общий футер: отсутствует блок или ссылка');
  if (navigation.linkIssues.length) result.problems.push('ссылки: неверная вкладка или rel');
}
async function checkCookiePersistence(page, result) {
  const policy = await page.evaluate(() => {
    const link = document.querySelector('.cookie-banner-link a[href]');
    if (!link) return null;
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    link.click();
    return { href: link.getAttribute('href'), consent: localStorage.getItem('cookieConsent') };
  });
  result.cookiePolicy = policy;
  if (policy?.href !== '/cookie' || policy.consent !== null) result.problems.push('куки: неверная ссылка на политику или клик записал согласие');
}
async function checkBackTop(page, result) {
  if (page.viewportSize().width <= 640) { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight - innerHeight - 300)); await page.waitForTimeout(400); } // у самого низа на телефоне стрелка скрыта
  const arrow = page.getByRole('button', { name: 'Вернуться к началу страницы' });
  const before = await page.evaluate(() => scrollY);
  if (before <= page.viewportSize().height) return;
  await arrow.click({ timeout: 3500 });
  await page.waitForFunction(() => scrollY <= 1, null, { timeout: 4000 });
  await arrow.waitFor({ state: 'hidden', timeout: 2000 });
  result.backTopClick = { before, after: await page.evaluate(() => scrollY) };
}
async function checkProgramAnchor(page, result) {
  await page.locator('a[href="#program"]:visible').first().click({ timeout: 4000 });
  await page.waitForFunction(() => {
    const model = JSON.parse(document.querySelector('#site-page').textContent);
    const anchor = model.anchors.find((a) => a.name === 'program');
    const element = document.getElementById(`rec${anchor?.scene}`);
    if (!element) return false;
    const top = element.getBoundingClientRect().top;
    return location.hash === '#program' && Math.abs(top - (model.shell.anchorOffset || 0)) <= 2;
  }, null, { timeout: 4500 });
  result.programAnchor = { hash: '#program', scrollY: await page.evaluate(() => scrollY) };
}
async function checkBurger(page, result) {
  const state = await page.evaluate(() => { const b = document.querySelector('.site-burger'); const n = document.querySelector('.site-nav'); return { burger: !!b && b.getBoundingClientRect().width > 0, nav: n && getComputedStyle(n).visibility }; });
  result.burger = state;
  if (!state.burger) return result.problems.push('нет бургера');
  if (state.nav !== 'hidden') return result.problems.push('меню открыто без нажатия');
  await page.tap('.site-burger');
  await page.waitForFunction(() => { const s = getComputedStyle(document.querySelector('.site-nav')); return s.visibility === 'visible' && Number(s.opacity) >= 0.9; }, null, { timeout: 2500 }).catch(() => result.problems.push('бургер не открывает меню'));
  const links = await page.evaluate(() => [...document.querySelectorAll('.site-nav__link')].filter((a) => a.getBoundingClientRect().height > 0).length);
  if (links < 5) result.problems.push(`в открытом меню видно пунктов ${links}`);
  await page.tap('.site-burger');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.site-nav')).visibility === 'hidden', null, { timeout: 2500 }).catch(() => result.problems.push('бургер не закрывает меню'));
}
async function check(route, view) {
  const context = await browser.newContext({ ...(engine === 'firefox' && FIREFOX_PHONES[view] ? FIREFOX_PHONES[view] : VIEWS[view]), locale: 'ru-RU' });
  const page = await context.newPage();
  const errors = [], external = [], failed = [], browserWarnings = [];
  const localRangeResponses = new Set(), localCanceledMedia = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Иконки нативных контролов WebKit живут во внутреннем shadow DOM и используют временные blob.
    if (engine === 'webkit' && text.startsWith('Button failed to load, iconName = ') &&
        text.includes(`layoutTraits = [MacOSLayoutTraits Inline], src = blob:${ORIGIN}/`)) {
      browserWarnings.push(text);
      return;
    }
    errors.push(text);
  });
  const requests = [];
  page.on('request', (r) => { if (!inlineResource(r.url(), ORIGIN)) requests.push({ method: r.method(), url: r.url() }); });
  page.on('requestfailed', (r) => {
    if (!r.url().startsWith(ORIGIN + '/')) return;
    const reason = r.failure()?.errorText;
    // Firefox сообщает NS_ERROR_PARSED_DATA_CACHED, когда разбор аудио отдан из кэша: файл не потерян (плавающая находка 09.11, повтор того же прогона зелёный)
    if (engine === 'firefox' && reason === 'NS_ERROR_PARSED_DATA_CACHED' && /\.(mp3|mp4)$/.test(new URL(r.url()).pathname)) browserWarnings.push(`Firefox: ${reason} ${safe(r.url())}`);
    else if (reason === 'net::ERR_ABORTED' && /\.(mp3|mp4)$/.test(new URL(r.url()).pathname)) localCanceledMedia.push(r.url());
    else failed.push(`${reason || 'requestfailed'} ${safe(r.url())}`);
  });
  page.on('response', (r) => {
    if (!r.url().startsWith(ORIGIN + '/')) return;
    if (r.status() >= 400) failed.push(`${r.status()} ${safe(r.url())}`);
    if (r.status() === 206 && r.headers()['content-range']) localRangeResponses.add(r.url());
  });
  await page.route('**/*', async (r) => { const q = r.request(); if (localRequest(q)) await r.continue(); else { external.push(`${q.method()} ${safe(q.url())}`); await r.abort(); } });
  const result = { path: route.path, view, errors, external, failed, browserWarnings, problems: [] };
  try {
    await page.goto(ORIGIN + route.path, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('main', { state: 'attached', timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);
    result.initialMedia = await page.evaluate(() => {
      const files = performance.getEntriesByType('resource').filter((r) => /\/media\/|\/shared\/assets\//.test(new URL(r.name).pathname));
      return { requests: files.length, transferBytes: files.reduce((sum, r) => sum + r.transferSize, 0), lazyImages: document.querySelectorAll('img[loading="lazy"]').length,
        deferredBackgrounds: document.querySelectorAll('.scene-node:not([data-background-ready]) > [style*="--sya-background-url:"]').length,
        deferredVideos: document.querySelectorAll('video[preload="none"]:not([src])').length };
    });
    if (engine === 'chromium') await settle(page);
    else if (route.path.startsWith('/audio-club')) {
      await page.waitForSelector('main #sya-club h1', { timeout: 10000 });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
    }
    if (engine === 'chromium' && route.path === '/clarity') {
      const loaded = await page.evaluate(() => [...document.querySelectorAll('[data-background-ready] > .scene-atom')].filter((atom) => getComputedStyle(atom).backgroundImage.startsWith('url(')).length);
      result.loadedBackgroundsAfterScroll = loaded;
      if (!result.initialMedia.deferredBackgrounds || !loaded) result.problems.push('фоновые картинки: не подтверждена отложенная загрузка');
    }
    Object.assign(result, await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, title: document.title, broken: [...document.images].filter((i) => i.complete && !i.naturalWidth).map((i) => i.currentSrc || i.src), fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`) })));
    result.etalon = measures[`${route.path}@${view}`]?.height;
    if (result.etalon) result.delta = (result.height - result.etalon) / result.etalon;
    if (result.scrollWidth > result.width) result.problems.push(`горизонтальная прокрутка ${result.scrollWidth}>${result.width}`);
    // Ровно один видимый h1 в живой странице (в статической выдаче считает tools/build-site.mjs)
    result.h1 = await page.evaluate(() => [...document.querySelectorAll('h1')].map((h) => { const r = h.getBoundingClientRect(); return { text: h.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), visible: r.width > 0 && r.height > 0 && getComputedStyle(h).visibility !== 'hidden' }; }));
    if (result.h1.length !== 1 || !result.h1[0].visible) result.problems.push(`h1: ${JSON.stringify(result.h1)}`);
    await checkShell(page, route, result);
    if (DOCS.includes(route.path)) {
      if (route.path === '/cookie') await checkCookiePersistence(page, result);
      result.doc = await page.evaluate(() => { const box = document.querySelector('.native-article>div'); const s = getComputedStyle(box); const title = document.querySelector('.native-article strong.doc-title'); return { width: box.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight), size: s.fontSize, title: title ? getComputedStyle(title).fontFamily : '' }; });
      if (view === '1440' && Math.round(result.doc.width) !== 960) result.problems.push(`колонка документа ${result.doc.width}, нужно 960`);
      if (result.doc.size !== (view === '1440' ? '16px' : '15px')) result.problems.push(`кегль документа ${result.doc.size}`);
      if (!result.doc.title.includes('Forum')) result.problems.push('заголовок документа не шрифтом сайта');
      if (isPhone(view)) await page.waitForFunction(() => getComputedStyle(document.querySelector('.site-nav')).visibility === 'hidden', null, { timeout: 1800 });
      Object.assign(result, await page.evaluate(() => ({ cookie: !!document.querySelector('.cookieBanner') && getComputedStyle(document.querySelector('.cookieBanner')).display !== 'none', footer: !!document.querySelector('footer .t396__artboard'), menuItems: document.querySelectorAll('.site-nav__link').length, navVisible: getComputedStyle(document.querySelector('.site-nav')).visibility, burgerVisible: getComputedStyle(document.querySelector('.site-bar')).display !== 'none' })));
      if (!result.cookie) result.problems.push('нет плашки куки');
      if (!result.footer) result.problems.push('нет футера');
      if (result.menuItems < 5) result.problems.push('нет пунктов меню');
      if (isPhone(view)) {
        if (!result.burgerVisible) result.problems.push('нет бургера');
        if (result.navVisible !== 'hidden') result.problems.push('меню открыто без нажатия');
        await page.tap('.site-burger');
        await page.waitForFunction(() => {
          const style = getComputedStyle(document.querySelector('.site-nav'));
          return style.visibility === 'visible' && Number(style.opacity) >= 0.9;
        }, null, { timeout: 1800 });
        const opened = await page.evaluate(() => { const nav = document.querySelector('.site-nav'); const s = getComputedStyle(nav); return { visibility: s.visibility, opacity: s.opacity, height: nav.getBoundingClientRect().height }; });
        result.openedMenu = opened;
        if (opened.visibility !== 'visible' || Number(opened.opacity) < 0.9 || opened.height < 100) result.problems.push('бургер не открывает меню');
        await page.tap('.site-burger');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.site-nav')).visibility === 'hidden', null, { timeout: 1800 });
      } else if (result.navVisible !== 'visible') result.problems.push('панель меню скрыта');
      result.links = await page.evaluate(() => ({ doc: !!document.querySelector('footer a[href="/oferta"]'), consent: !!document.querySelector('footer a[href="/consent"]'), lk: document.querySelector('.site-nav__button')?.getAttribute('href') }));
      if (!result.links.doc || !result.links.consent) result.problems.push('ссылки футера не локальные');
      if (!/^https:\/\/lk\.sistemayasnosti\.com/.test(result.links.lk || '')) result.problems.push('кнопка ЛК ведёт не туда');
      await page.evaluate(() => window.scrollTo(0, innerWidth <= 640 ? document.body.scrollHeight - innerHeight - 300 : document.body.scrollHeight)); await page.waitForTimeout(500);
      const backTopAbove = await page.evaluate(() => !!document.querySelector('.back-top'));
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(500);
      const backTopAtEnd = await page.evaluate(() => !!document.querySelector('.back-top'));
      if (page.viewportSize().width <= 640 && backTopAtEnd) result.problems.push('стрелка закрывает ссылки футера у самого низа');
      Object.assign(result, { backTop: backTopAbove }, await page.evaluate(() => ({ progress: parseFloat(document.querySelector('.scroll-indicator')?.style.width || '0'), menuBg: document.querySelector('.site-nav').style.backgroundColor })));
      // Кнопка появляется после прокрутки больше высоты окна; короткие документы столько не прокручиваются
      if (!result.backTop && result.height - page.viewportSize().height > page.viewportSize().height) result.problems.push('нет кнопки «наверх» внизу страницы');
      if (result.progress < 95) result.problems.push(`индикатор прокрутки ${result.progress}%`);
      // По логике живой Тильды согласие даёт любой клик вне ссылки на политику: на 390 это уже сделало нажатие на бургер
      if (!isPhone(view)) await page.locator('.cookieBanner .scene-button .scene-atom:visible').first().click();
      await page.waitForTimeout(700);
      result.cookieAfterAccept = await page.evaluate(() => ({ display: getComputedStyle(document.querySelector('.cookieBanner')).display, stored: localStorage.getItem('cookieConsent') }));
      if (result.cookieAfterAccept.display !== 'none' || result.cookieAfterAccept.stored !== 'accepted') result.problems.push('плашка куки не принимает согласие');
      if (route.path === '/cookie') {
        await checkBackTop(page, result);
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelector('[data-embed="cookie-consent"]'), null, { timeout: 5000 });
        await page.waitForTimeout(450);
        result.cookieAfterReload = await page.evaluate(() => ({ hidden: getComputedStyle(document.querySelector('.cookieBanner')).display === 'none', dated: Number.isFinite(Date.parse(localStorage.getItem('cookieConsentDate'))) }));
        if (!result.cookieAfterReload.hidden || !result.cookieAfterReload.dated) result.problems.push('куки: согласие не сохранилось после перезагрузки');
      }
    }
    if (VIDEOS[route.path]) await checkVideos(page, route, result);
    if (engine === 'chromium' || route.path === '/') {
      await checkAnimations(page, route, view, result);
      await checkEmbeds(page, route, view, result);
      if (POPUPS[route.path]) await checkPopups(page, route, result, requests);
    } else if (engine === 'firefox' && isPhone(view)) {
      // Firefox на телефонной ширине: меню на каждой странице и попап с формой там, где он есть
      if (!DOCS.includes(route.path)) await checkBurger(page, result);
      if (POPUPS[route.path]) await checkPopups(page, route, result, requests);
    }
    if (route.path === '/clarity') await checkProgramAnchor(page, result);
  } catch (e) { result.exception = e.message.split('\n')[0]; }
  if (result.exception) result.problems.push(result.exception);
  if (errors.length) result.problems.push('ошибки JS');
  if (external.length) result.problems.push('внешние запросы');
  for (const url of localCanceledMedia) {
    // Chromium может закончить запрос preload=metadata сразу после получения нужного диапазона.
    if (localRangeResponses.has(url)) browserWarnings.push(`загрузка медиа прервана браузером после 206: ${safe(url)}`);
    else failed.push(`net::ERR_ABORTED ${safe(url)}`);
  }
  if (failed.length) result.problems.push('не загрузились файлы');
  if (result.broken?.length) result.problems.push('битые картинки');
  result.overflow = result.scrollWidth > result.width;
  results.push(result);
  await context.close();
}
// prefers-reduced-motion: ни закрепления, ни покадровых анимаций, попап без выезда
async function checkReduced() {
  const context = await browser.newContext({ ...VIEWS[390], locale: 'ru-RU', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const result = { path: '/clarity+/', view: 'reduced', errors: [], external: [], failed: [], problems: [] };
  await page.route('**/*', async (r) => { const q = r.request(); if (localRequest(q)) await r.continue(); else { result.external.push(`${q.method()} ${safe(q.url())}`); await r.abort(); } });
  try {
    await page.goto(`${ORIGIN}/clarity`, { waitUntil: 'load' }); await page.waitForTimeout(600);
    const animated = await page.evaluate(() => ({ items: [...document.querySelectorAll('[data-node]')].filter((x) => x.__sbs).length, running: document.getAnimations().filter((a) => a.playState === 'running').length }));
    result.reduced = animated;
    if (animated.items) result.problems.push(`покадровых анимаций ${animated.items} при reduced-motion`);
    await page.goto(`${ORIGIN}/`, { waitUntil: 'load' }); await page.waitForTimeout(600);
    result.reducedVideo = await page.evaluate(() => {
      const video = document.querySelector('main video');
      return { paused: video?.paused, poster: video?.getAttribute('poster'), src: video?.getAttribute('src') };
    });
    if (!result.reducedVideo.paused || !result.reducedVideo.poster || result.reducedVideo.src) result.problems.push('видео при reduced-motion: нужен статичный кадр без загрузки MP4');
    await page.evaluate(() => [...document.querySelectorAll('a[href="#zeropopup"]')].find((x) => x.getClientRects().length).click());
    await page.waitForTimeout(40);
    const shift = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.native-dialog')).transform).m42);
    result.reducedPopupShift = shift;
    if (shift !== 0) result.problems.push(`попап выезжает при reduced-motion: ${shift}`);
  } catch (e) { result.problems.push(e.message.split('\n')[0]); }
  if (result.external.length) result.problems.push('внешние запросы');
  results.push(result);
  await context.close();
}
async function checkIntegrations() {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const prod = `https://${PRODUCTION_HOSTNAME}`;
  const entry = '/?utm_source=smoke&utm_campaign=migration&gclid=qa&yclid=qa&r=qa';
  const result = { path: '/?utm_…', view: 'интеграции с заглушками', problems: [], external: [], errors: [] };
  const stubs = new Map([
    [METRIKA_SCRIPT_URL, 'window.__metrikaStubLoaded = true;'],
    [KOMMO.scriptUrl, 'window.__kommoStubLoaded = true;'],
  ]);
  const intercepted = [];
  page.on('pageerror', (e) => result.errors.push(e.message));
  // Весь боевой hostname обслуживается нашим loopback-сервером. Скрипты поставщиков подменены, остальное блокируется.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (inlineResource(url.href, prod)) return route.continue();
    if (stubs.has(url.href)) {
      intercepted.push(url.href);
      return route.fulfill({ contentType: 'application/javascript', body: stubs.get(url.href) });
    }
    if (url.origin === prod && route.request().method() === 'GET') {
      const response = await fetch(ORIGIN + url.pathname + url.search, { redirect: 'error' });
      return route.fulfill({
        status: response.status,
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        body: Buffer.from(await response.arrayBuffer()),
      });
    }
    result.external.push(safe(url.href));
    return route.abort();
  });
  try {
    await page.goto(prod + entry, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__metrikaStubLoaded && window.__kommoStubLoaded, null, { timeout: 10000 });
    const state = await page.evaluate(() => ({
      init: (window.ym?.a || []).map((x) => [...x]).filter((x) => x[1] === 'init'),
      kommo: { id: window.crm_plugin?.id, locale: window.crm_plugin?.locale, queue: typeof window.crmPlugin === 'function' },
      consent: localStorage.getItem('cookieConsent'),
      checkout: [...new Set([...document.querySelectorAll('a[href*="/payments/tariff_"]')].map((a) => a.href))].sort(),
      login: document.querySelector('.site-nav__button')?.href,
      bot: !!document.querySelector('a[href="tg://resolve?domain=sistemayasnostibot&start=start"]'),
    }));
    const [id, , init] = state.init[0] || [];
    const checkout = ['rOjAZQ', 'wO4vRP', 'wZ2zZ1'].map((tariff) => `https://lk.sistemayasnosti.com/payments/tariff_${tariff}/checkout`).sort();
    const metrika = state.init.length === 1 && id === METRIKA_ID && init.url === prod + entry && init.trackLinks === true;
    const kommo = state.kommo.id === '1059843' && state.kommo.locale === 'en' && state.kommo.queue;
    const attribution = state.bot && state.login === 'https://lk.sistemayasnosti.com/' && JSON.stringify(state.checkout) === JSON.stringify(checkout);
    Object.assign(result, { metrika, kommo, attribution, consentBeforeInit: state.consent, intercepted });
    if (!metrika || !kommo || intercepted.length !== 2 || state.consent !== null) result.problems.push('интеграции: запуск, дубли или порядок относительно согласия');
    if (!attribution) result.problems.push('атрибуция: изменились параметры ссылок ЛК, checkout или Telegram');
  } catch (error) {
    result.problems.push(error.message.split('\n')[0]);
  } finally {
    if (result.external.length || result.errors.length) result.problems.push('интеграции: неожиданные запросы или ошибки JS');
    results.push(result);
    await context.close();
  }
}
try {
  const views = engine === 'firefox' ? ['1440', '390', '360'] : ['1440', '390'];
  for (const route of routes) for (const view of views) await check(route, view);
  if (engine !== 'firefox' && (!requestedRoutes.size || requestedRoutes.has('/'))) await checkReduced();
  if (engine === 'chromium' && (!requestedRoutes.size || requestedRoutes.has('/'))) await checkIntegrations();
} finally { await browser.close(); server?.close(); }
const suffix = [engine !== 'chromium' && engine, requestedRoutes.size && 'focused'].filter(Boolean).join('-');
const report = `docs/smoke${suffix ? '-' + suffix : ''}.json`;
const coverage = requestedRoutes.size ? routes.map((route) => route.path).join(', ') : 'все 12 страниц';
const scope = engine === 'chromium' ? `${coverage} на 1440 и 390, расширенные сценарии и применимые интеграции с заглушками` : `${coverage}, общая проверка и применимые сценарии главной, стрелки и куки`;
fs.writeFileSync(report, JSON.stringify({ at: new Date().toISOString(), engine, scope: `локальная статика, ${scope}`, results }, null, 1));
for (const r of results) console.log(`${r.problems.length ? 'ОШИБКА' : 'ок'}  ${r.path}@${r.view}  высота ${r.height} / эталон ${r.etalon} (${r.delta === undefined ? '?' : (r.delta * 100).toFixed(2) + ' %'})${DOCS.includes(r.path) ? ' не сравнивается' : ''}${r.overflow ? `  гориз.прокрутка ${r.scrollWidth}` : ''}${r.problems.length ? '  — ' + r.problems.join('; ') : ''}`);
const bad = results.filter((r) => r.problems.length);
if (bad.length) { console.error(`Смоук не пройден: ${bad.length} из ${results.length}, подробности в ${report}`); process.exit(1); }
console.log(`Смоук пройден: ${results.length} проверок`);
process.exit(0);
