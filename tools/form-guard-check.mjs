// Форма без ИИ: на любом адресе, включая боевой домен, показывается успешная отправка (решение Елены 10.11.2026).
// Исходящих POST/PUT/PATCH/DELETE быть не должно, внешние запросы блокируются.
// Боевой домен подменяется на локальный превью-сервер: --host-resolver-rules="MAP sistemayasnosti.com 127.0.0.1:PORT". В интернет ничего не уходит.
// Запуск: node tools/form-guard-check.mjs [/ /mini /taplink]. Код выхода 1 при любой ошибке. Отчёт: docs/form-guard-check.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import { startPreview, PREVIEW_PORT } from './preview-static.mjs';

const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/mini', '/taplink'];
const PROD = 'http://sistemayasnosti.com';
const WWW = 'http://www.sistemayasnosti.com';
const LOCAL = `http://127.0.0.1:${PREVIEW_PORT}`;
const MODES = [
  { name: 'боевой домен (по http, через подмену DNS)', base: PROD, expect: 'Данные успешно отправлены', forbid: 'Заявка не отправлена' },
  { name: 'www боевого домена (по http, через подмену DNS)', base: WWW, expect: 'Данные успешно отправлены', forbid: 'Заявка не отправлена' },
  { name: 'локальный адрес', base: LOCAL, expect: 'Данные успешно отправлены', forbid: 'Заявка не отправлена' },
];
const isLocalOrigin = (u) => u.startsWith(LOCAL + '/') || u.startsWith(PROD + '/') || u.startsWith(WWW + '/') || u.startsWith('data:') || u.startsWith(`blob:${LOCAL}/`) || u.startsWith(`blob:${PROD}/`);
const safe = (value) => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return '[адрес]'; } };

const server = await startPreview(PREVIEW_PORT);
const browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP sistemayasnosti.com 127.0.0.1:${PREVIEW_PORT},MAP www.sistemayasnosti.com 127.0.0.1:${PREVIEW_PORT}`] });
const results = [];
try {
  for (const mode of MODES) for (const route of routes) {
    const result = { mode: mode.name, route, problems: [], status: '', writes: [], blocked: [] };
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
    const page = await context.newPage();
    page.on('request', (r) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) result.writes.push(`${r.method()} ${safe(r.url())}`); });
    page.on('pageerror', (e) => result.problems.push(`ошибка JS: ${e.message}`));
    await page.route('**/*', (r) => {
      const q = r.request();
      if (isLocalOrigin(q.url())) return r.continue();
      result.blocked.push(`${q.method()} ${safe(q.url())}`);
      return r.abort();
    });
    try {
      await page.goto(mode.base + route, { waitUntil: 'load', timeout: 30000 });
      await page.waitForSelector('main', { state: 'attached', timeout: 10000 });
      await page.evaluate(() => document.fonts.ready);
      result.host = await page.evaluate(() => location.origin);
      if (result.host !== mode.base) result.problems.push(`открылся ${result.host}, нужен ${mode.base}`);
      const link = 'a[href="#zeropopup"]';
      const visible = await page.evaluate((s) => [...document.querySelectorAll(s)].some((x) => x.getClientRects().length), link);
      if (!visible) { result.problems.push('нет видимой ссылки на форму (на этой странице формы нет?)'); throw new Error('stop'); }
      await page.evaluate((s) => [...document.querySelectorAll(s)].find((x) => x.getClientRects().length).scrollIntoView({ block: 'center', behavior: 'instant' }), link);
      await page.waitForTimeout(1200);
      await page.evaluate((s) => [...document.querySelectorAll(s)].find((x) => x.getClientRects().length).click(), link);
      await page.waitForSelector('.native-dialog .zero-form__input', { timeout: 4000 });
      await page.waitForTimeout(700);
      const fields = page.locator('.native-dialog .zero-form__input');
      if (await fields.count() !== 4) result.problems.push(`полей ${await fields.count()}, нужно 4`);
      await fields.nth(0).fill('Анна Проверка');
      await fields.nth(1).pressSequentially('9001234567');
      await fields.nth(2).fill('@qa_local');
      await fields.nth(3).fill('Локальная проверка защиты формы');
      await page.locator('.native-dialog .zero-form__submit').click();
      const status = await page.locator('.native-dialog [role=status]').innerText({ timeout: 3500 }).catch(() => '');
      result.status = status.replace(/\s+/g, ' ').trim();
      if (!status.includes(mode.expect)) result.problems.push(`нет надписи «${mode.expect}», на экране: «${result.status || 'ничего'}»`);
      if (status.includes(mode.forbid)) result.problems.push(`показана надпись «${mode.forbid}»`);
      if (await page.locator('.native-dialog .zero-form__error').count()) result.problems.push('форма показывает ошибки при верных данных');
    } catch (error) { if (error.message !== 'stop') result.problems.push(error.message.split('\n')[0]); }
    if (result.writes.length) result.problems.push(`исходящие запросы с телом: ${result.writes.join(', ')}`);
    results.push(result);
    await context.close();
  }
} finally { await browser.close(); server.close(); }

fs.writeFileSync('docs/form-guard-check.json', JSON.stringify({ at: new Date().toISOString(), note: 'локальная статика, живой сайт не открывался, внешние запросы перехвачены', results }, null, 1));
for (const r of results) console.log(`${r.problems.length ? 'ОШИБКА' : 'ок'}  ${r.mode} ${r.route}: «${r.status}» блок. внешних: ${r.blocked.length}${r.problems.length ? ' | ' + r.problems.join('; ') : ''}`);
const bad = results.filter((r) => r.problems.length);
if (bad.length) { console.error(`Защита формы не пройдена: ${bad.length} из ${results.length}`); process.exit(1); }
console.log(`Защита формы пройдена: ${results.length} проверок`);
process.exit(0);
