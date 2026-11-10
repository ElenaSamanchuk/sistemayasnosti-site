// Скрины формы Zero с открытым выбором страны (1440 и 390), по одному браузеру без окна. Запуск: nice node tools/form-shots.mjs [/путь]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { startPreview, PREVIEW_PORT } from './preview-static.mjs';
const route = process.argv[2] || '/';
const slug = route === '/' ? 'index' : route.slice(1);
const VIEWS = { 1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, 390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } };
fs.mkdirSync('docs/screens/form', { recursive: true });
const server = await startPreview();
const browser = await chromium.launch({ headless: true });
for (const [w, opts] of Object.entries(VIEWS)) {
  const page = await (await browser.newContext(opts)).newPage();
  await page.goto(`http://127.0.0.1:${PREVIEW_PORT}${route}`); await page.waitForTimeout(1500);
  const link = page.locator('a[href="#zeropopup"]:visible').first();
  await link.scrollIntoViewIfNeeded(); await link.click(); await page.waitForSelector('.native-dialog'); await page.waitForTimeout(1200);
  await page.screenshot({ path: `docs/screens/form/${slug}-${w}-closed.png` });
  await page.locator('.native-dialog .zero-form__country').click(); await page.waitForTimeout(400);
  await page.screenshot({ path: `docs/screens/form/${slug}-${w}-open.png` });
  await page.locator('.zero-form__option', { hasText: 'Испания' }).click(); await page.waitForTimeout(200);
  await page.locator('.native-dialog .zero-form__input--country').pressSequentially('600123456');
  await page.screenshot({ path: `docs/screens/form/${slug}-${w}-spain.png` });
}
await browser.close(); server.close();
