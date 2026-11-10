// Аудит типографа в Zero-блоках без ИИ: считает строки текста в каждом узле без типографа и с ним на всех ширинах сетки.
// Узлы, где неразрывные пробелы добавили строку, записываются в sources/typograf-skip.json, затем сборка проверяется ещё раз.
// Запуск: node tools/typograf-audit.mjs. Код выхода 1, если после исключения лишние строки остались. Живой сайт не открывается.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { startPreview, PREVIEW_PORT } from './preview-static.mjs';

const ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
const WIDTHS = [320, 390, 480, 640, 960, 1200];
const SKIP_FILE = 'sources/typograf-skip.json';
const POPUP_PAGES = ['/', '/mini', '/taplink', '/about'];

function build(env) {
  for (const command of [['python3', ['tools/normalize_export.py', '--all']], ['node', ['tools/build-site.mjs']]]) {
    const run = spawnSync(command[0], command[1], { env: { ...process.env, ...env }, encoding: 'utf8' });
    if (run.status !== 0) { console.error(run.stdout, run.stderr); process.exit(2); }
  }
}

const readPage = () => document.fonts.ready.then(() => {
  const out = {};
  for (const element of document.querySelectorAll('.scene-text[data-node], .scene-button[data-node]')) {
    if (!element.getClientRects().length) continue;
    const atom = element.querySelector(':scope > .scene-atom');
    if (!atom || !atom.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(atom);
    const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0.5).map((r) => Math.round(r.bottom)));
    const scene = element.closest('[data-scene]')?.dataset.scene;
    out[`${scene}/${element.dataset.node}`] = { lines: lines.size, text: atom.textContent.trim().slice(0, 80) };
  }
  return out;
});

async function measure(browser, routes) {
  const data = {};
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', locale: 'ru-RU' });
    const page = await context.newPage();
    await page.route('**/*', async (r) => { if (r.request().url().startsWith(ORIGIN) && r.request().method() === 'GET') await r.continue(); else await r.abort(); });
    for (const route of routes) {
      await page.goto(ORIGIN + route.path + (POPUP_PAGES.includes(route.path) ? '#zeropopup' : ''), { waitUntil: 'load' });
      await page.waitForSelector('main', { state: 'attached' });
      await page.waitForTimeout(250);
      data[`${route.path}@${width}`] = await page.evaluate(readPage);
    }
    await context.close();
  }
  return data;
}

function compare(before, after) {
  const found = {};
  for (const [key, nodes] of Object.entries(after)) {
    const [path, width] = key.split('@');
    for (const [id, node] of Object.entries(nodes)) {
      const original = before[key]?.[id];
      if (!original || node.lines <= original.lines) continue;
      const nodeId = id.split('/')[1];
      const item = (found[nodeId] ||= { pages: [], widths: [], text: node.text, linesBefore: original.lines, linesAfter: node.lines });
      if (!item.pages.includes(path)) item.pages.push(path);
      if (!item.widths.includes(Number(width))) item.widths.push(Number(width));
    }
  }
  return found;
}

const busy = await new Promise((resolve) => { const s = net.connect(PREVIEW_PORT, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
const server = busy ? null : await startPreview();
const browser = await chromium.launch({ headless: true });
const routes = () => JSON.parse(fs.readFileSync('public/content/routes.json', 'utf8'));
let code = 0;
try {
  build({ ZERO_TYPOGRAF: '0' });
  const before = await measure(browser, routes());
  build({ ZERO_TYPOGRAF: '1', TYPOGRAF_NO_SKIP: '1' });
  const nodes = compare(before, await measure(browser, routes()));
  fs.writeFileSync(SKIP_FILE, JSON.stringify({ _comment: 'Узлы Zero, где неразрывные пробелы типографа добавляют строку. Для них неразрывные пробелы не ставятся. Создаётся tools/typograf-audit.mjs.', widths: WIDTHS, nodes }, null, 1) + '\n');
  build({});
  const left = compare(before, await measure(browser, routes()));
  const measured = Object.values(before).reduce((sum, page) => sum + Object.keys(page).length, 0);
  console.log(`Измерено текстов (страница × ширина): ${measured}. Узлов с лишней строкой исключено: ${Object.keys(nodes).length}. Осталось после исключения: ${Object.keys(left).length}.`);
  if (Object.keys(left).length) { console.error(JSON.stringify(left, null, 1)); code = 1; }
} finally { await browser.close(); server?.close(); }
process.exit(code);
