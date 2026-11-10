// Скрины переноса /oferta тем же способом, что и эталоны (окно, DPR, плитки JPEG). Эталоны заново не снимаются, а копируются из снимка.
import { chromium } from 'playwright';
import fs from 'node:fs';
import net from 'node:net';
import { startPreview, PREVIEW_PORT } from './preview-static.mjs';
const OUT = 'docs/screens/oferta'; const REF = 'sources/live/2026-11-09/reference/oferta'; const TILE = 4500;
const VIEWS = { 1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, 390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } };
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(REF)) if (f.endsWith('.jpg')) fs.copyFileSync(`${REF}/${f}`, `${OUT}/${f.replace('.jpg', '-etalon.jpg')}`);
const busy = await new Promise((resolve) => { const s = net.connect(PREVIEW_PORT, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
const server = busy ? null : await startPreview();
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, options] of Object.entries(VIEWS)) {
    const context = await browser.newContext({ ...options, locale: 'ru-RU' });
    const page = await context.newPage();
    await page.route('**/*', (r) => (r.request().url().startsWith(`http://127.0.0.1:${PREVIEW_PORT}/`) || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
    await page.goto(`http://127.0.0.1:${PREVIEW_PORT}/oferta`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    let h = await page.evaluate(() => document.documentElement.scrollHeight);
    const step = Math.floor(options.viewport.height * 0.8);
    for (let y = 0; y < h + step; y += step) { await page.evaluate((top) => window.scrollTo(0, top), y); await page.waitForTimeout(120); }
    await page.waitForTimeout(1500); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(800);
    h = await page.evaluate(() => document.documentElement.scrollHeight);
    let i = 0;
    for (let top = 0; top < h; top += TILE) { i += 1; await page.screenshot({ path: `${OUT}/${name}-${String(i).padStart(2, '0')}-perenos.jpg`, fullPage: true, clip: { x: 0, y: top, width: options.viewport.width, height: Math.min(TILE, h - top) }, type: 'jpeg', quality: 82 }); }
    if (name === '390') { await page.tap('.site-burger'); await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/390-menu-open-perenos.jpg`, type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: 390, height: 400 } }); }
    console.log(`${name}: высота ${h}, плиток ${i}`);
    await context.close();
  }
} finally { await browser.close(); server?.close(); }
process.exit(0);
