// Пары «эталон | перенос» для всех страниц: тем же способом, что и эталоны (окно, DPR, плитки).
// Эталоны с живого сайта заново не снимаются. Запуск: npm run shots:pages [-- /clarity /mini]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { startPreview, PREVIEW_PORT } from './preview-static.mjs';

const REF = 'sources/live/2026-11-09/reference';
const OUT = 'docs/screens/pages';
const TILE = 4500;
const ALL = ['/', '/taplink', '/mini', '/about', '/clarity', '/audio-club', '/audio-club-old', '/audio-club-old-old', '/oferta', '/privacy', '/consent', '/cookie'];
const VIEWS = {
  1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const slug = (p) => (p === '/' ? 'index' : p.slice(1));
const routes = process.argv.slice(2).length ? [...new Set(process.argv.slice(2))] : ALL;
const generatedImage = /^(?:(?:1440|390)-\d+-(?:perenos|etalon)|pair-(?:1440|390)-\d+)\.jpg$/;
const failedRoutes = new Set();
fs.mkdirSync(OUT, { recursive: true });
const server = await startPreview();
const browser = await chromium.launch({ headless: true });
let staging;
try {
  staging = fs.mkdtempSync(`${OUT}/.page-shots-`);
  for (const [name, options] of Object.entries(VIEWS)) {
    const context = await browser.newContext({ ...options, locale: 'ru-RU' });
    for (const route of routes) {
      const dir = `${staging}/${slug(route)}`;
      fs.mkdirSync(dir, { recursive: true });
      const page = await context.newPage();
      const local = `http://127.0.0.1:${PREVIEW_PORT}/`;
      await page.route('**/*', (r) => (r.request().url().startsWith(local) || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
      try {
        await page.goto(`${local}${route.slice(1)}`, { waitUntil: 'load', timeout: 60000 });
        await page.evaluate(() => document.fonts.ready);
        // Аудиоклуб дорисовывается после load: до этого страница высотой в одно окно, и обход кончался раньше, чем блоки ниже появлялись
        if (route.startsWith('/audio-club')) await page.waitForFunction(() => document.getElementById('sya-club-app')?.children.length > 0, null, { timeout: 15000 });
        let h = await page.evaluate(() => document.documentElement.scrollHeight);
        const step = Math.floor(options.viewport.height * 0.8);
        for (let y = 0; y < h + step; y += step) {
          await page.evaluate((top) => window.scrollTo(0, top), y);
          await page.waitForTimeout(120);
          h = await page.evaluate(() => document.documentElement.scrollHeight);
        }
        await page.waitForTimeout(1500);
        // Блоки с появлением по прокрутке обязаны раскрыться до съёмки, иначе на скрине пустота, которой у посетителя нет
        const pending = await page.evaluate(() => [...document.querySelectorAll('[data-sya-reveal]')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height > 0 && getComputedStyle(e).opacity === '0').length);
        if (pending) throw new Error(`не раскрылись блоки аудиоклуба: ${pending}`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(800);
        h = await page.evaluate(() => document.documentElement.scrollHeight);
        let i = 0;
        for (let top = 0; top < h; top += TILE) {
          i += 1;
          await page.screenshot({
            path: `${dir}/${name}-${String(i).padStart(2, '0')}-perenos.jpg`,
            fullPage: true, type: 'jpeg', quality: 82,
            clip: { x: 0, y: top, width: options.viewport.width, height: Math.min(TILE, h - top) },
          });
        }
        for (const f of fs.readdirSync(`${REF}/${slug(route)}`)) {
          if (f.startsWith(`${name}-`) && f.endsWith('.jpg')) fs.copyFileSync(`${REF}/${slug(route)}/${f}`, `${dir}/${f.replace('.jpg', '-etalon.jpg')}`);
        }
        console.log(`${route} ${name}: высота ${h}, плиток ${i}`);
      } catch (e) {
        failedRoutes.add(slug(route));
        console.error(`ОШИБКА ${route} ${name}: ${e.message}`);
      }
      await page.close();
    }
    await context.close();
  }
  const completed = routes.map(slug).filter((name) => !failedRoutes.has(name));
  if (completed.length) {
    execFileSync('python3', ['tools/page_pairs.py', '--output-root', staging, ...completed], { stdio: 'inherit' });
    for (const name of completed) {
      const dir = `${OUT}/${name}`;
      const files = new Set(fs.readdirSync(`${staging}/${name}`));
      fs.mkdirSync(dir, { recursive: true });
      for (const f of files) fs.renameSync(`${staging}/${name}/${f}`, `${dir}/${f}`);
      for (const f of fs.readdirSync(dir)) {
        if (generatedImage.test(f) && !files.has(f)) fs.unlinkSync(`${dir}/${f}`);
      }
    }
  }
} finally {
  if (staging) fs.rmSync(staging, { recursive: true, force: true });
  await browser.close();
  await server?.close?.();
}
if (failedRoutes.size) process.exitCode = 1;
