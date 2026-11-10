#!/usr/bin/env node
// Правило заказчика (10.11.2026): у двух соседних Zero-блоков одного цвета берётся ОДИН отступ, больший из двух.
// При разных цветах отступы складываются, то есть ничего не меняем.
// Скрипт без браузера читает routes.json, страницы, CSS блоков и пишет src/block-spacing.css.
// Запуск: node tools/block-spacing.mjs [--check] [--strict-colors] [--json файл] [--quiet]
//   --check  только сравнить с записанным файлом, при расхождении код выхода 1
//   --strict-colors   считать #f5f4f2 и #f5f5f5 разными; по умолчанию почти равные цвета считаются одним, глазом они не различаются
//   --json   записать все решения по парам в файл (для сверки с браузером)
import fs from 'node:fs';
import path from 'node:path';
import { field, screenFor } from '../src/lib/scene.mjs';
import { embeds as registry } from '../src/embeds/registry.mjs';

const CONTENT = 'public/content';
const OUTPUT = 'src/block-spacing.css';
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const quiet = args.includes('--quiet');
const nearColors = !args.includes('--strict-colors');
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

// sample — ширина окна, на которой считаем то, что зависит от окна: масштаб и «на всю ширину»
const RANGES = [
  { screen: 1200, media: '(min-width:1200px)', sample: 1440 },
  { screen: 960, media: '(min-width:960px) and (max-width:1199px)', sample: 1080 },
  { screen: 640, media: '(min-width:640px) and (max-width:959px)', sample: 800 },
  { screen: 480, media: '(min-width:480px) and (max-width:639px)', sample: 560 },
  { screen: 320, media: '(max-width:479px)', sample: 390 },
];
// Блоки, которые по заданию не трогаем ни в какой паре
const FROZEN = new Map([
  ['2426973813', 'липкий/fixed-блок /clarity'],
  ['2426973823', 'липкий/fixed-блок /clarity'],
  ['2426973833', 'липкий/fixed-блок /clarity'],
  ['1703875663', 'скрепка выходит за верх блока /mini'],
]);
const EPS = 0.5;
const round = (v) => Math.round(v * 100) / 100;
const read = (file) => fs.readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(read(file));

// ---------- CSS: разбор и каскад по ширине окна ----------
function parseCss(text) {
  const rules = [];
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  const block = (media) => {
    while (i < src.length) {
      const open = src.indexOf('{', i), close = src.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = src.length; return; }
      const head = src.slice(i, open).replace(/^[\s;]*(@(import|charset)[^;]*;\s*)*/g, '').trim();
      i = open + 1;
      if (head.startsWith('@media')) { block(head.slice(6).trim()); continue; }
      if (head.startsWith('@')) { skipBlock(); continue; }
      const end = src.indexOf('}', i);
      rules.push({ media, selectors: splitSelectors(head), decls: parseDecls(src.slice(i, end)) });
      i = end + 1;
    }
  };
  const skipBlock = () => { let depth = 1; while (i < src.length && depth) { if (src[i] === '{') depth++; if (src[i] === '}') depth--; i++; } };
  block(null);
  return rules;
}
function splitSelectors(head) {
  const out = []; let depth = 0, cur = '';
  for (const ch of head) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseDecls(text) {
  const out = {}; let depth = 0, cur = '';
  const flush = () => { const at = cur.indexOf(':'); if (at > 0) out[cur.slice(0, at).trim().toLowerCase()] = cur.slice(at + 1).replace(/!important/i, '').trim(); cur = ''; };
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && !depth) flush(); else cur += ch;
  }
  flush();
  return out;
}
function mediaMatches(media, width) {
  if (!media) return true;
  if (/scripting|hover|pointer|prefers-/.test(media)) return false;
  for (const m of media.matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)) {
    if (m[1] === 'min' && width < Number(m[2])) return false;
    if (m[1] === 'max' && width > Number(m[2])) return false;
  }
  return true;
}
// Индекс: строка селектора → правила в порядке файла
function indexRules(rules) {
  const map = new Map();
  rules.forEach((rule, order) => {
    for (const selector of rule.selectors) {
      const key = selector.replace(/\s+/g, ' ');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ ...rule, order });
    }
  });
  return map;
}
function cascade(index, selectors, width) {
  const hits = selectors.flatMap((s) => index.get(s) || []).filter((r) => mediaMatches(r.media, width)).sort((a, b) => a.order - b.order);
  return Object.assign({}, ...hits.map((r) => r.decls));
}

// ---------- Правки из src/style.css: скрытые элементы и сдвиги translate ----------
function nodeOverrides(rules) {
  const list = [];
  for (const rule of rules) {
    if (!('display' in rule.decls) && !('translate' in rule.decls)) continue;
    for (const selector of rule.selectors) {
      if (!selector.includes('data-node')) continue;
      // Правила для вложенных частей (.scene-atom) на положение элемента не влияют
      if (/\]\s+[.#\w]/.test(selector.replace(/:is\([^)]*\)/g, ':is'))) continue;
      const ids = [...selector.matchAll(/\[data-node="(\d+)"\]/g)].map((m) => m[1]);
      list.push({ media: rule.media, ids: new Set(ids), decls: rule.decls });
    }
  }
  return list;
}
function overrideFor(list, id, width) {
  const out = { hidden: false, translateY: 0 };
  for (const item of list) {
    if (!item.ids.has(id) || !mediaMatches(item.media, width)) continue;
    if ('display' in item.decls) out.hidden = item.decls.display === 'none';
    if ('translate' in item.decls) {
      const parts = item.decls.translate.split(/\s+/);
      out.translateY = item.decls.translate === 'none' ? 0 : parseFloat(parts[1] || '0') || 0;
    }
  }
  return out;
}

// ---------- Цвета ----------
function loadTokens() {
  const tokens = {};
  for (const m of read('src/tokens.css').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}
const TOKENS = loadTokens();
function resolveVar(value) {
  let out = String(value ?? '').trim();
  for (let guard = 0; guard < 5 && out.includes('var('); guard++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name, fallback) => TOKENS[name] ?? fallback ?? '');
  }
  return out.trim();
}
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
function parseColor(value) {
  const text = resolveVar(value).toLowerCase();
  if (!text) return null;
  if (NAMED[text]) return NAMED[text];
  let m = text.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1].length < 6 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((at) => parseInt(h.slice(at, at + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1);
  }
  m = text.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  return null;
}
function over(color, base) {
  const a = color[3];
  return [0, 1, 2].map((i) => Math.round(color[i] * a + base[i] * (1 - a))).concat(1);
}
const hexOf = (c) => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const hasImage = (value) => { const v = resolveVar(value); return !!v && v !== 'none' && /url\(|gradient\(/.test(v); };

// ---------- Геометрия и фон одного блока на одном экране ----------
function collectElements(scene, screen, ctx) {
  const elements = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      const override = overrideFor(ctx.overrides, node.id, ctx.width);
      if (override.hidden) continue;
      const selectors = [`[data-node="${node.id}"]`, `#scene-${scene.id} [data-node="${node.id}"]`];
      const box = cascade(ctx.css, selectors, ctx.width);
      if (box.display === 'none') continue;
      const physicalFlex = node.type === 'group' && node.fields.flex && node.fields.flex !== 'none';
      if (node.type === 'group' && !physicalFlex && node.children?.length) { walk(node.children); continue; }
      elements.push(makeElement(scene, node, screen, ctx, override, box, elements.length));
    }
  };
  walk(scene.nodes);
  return elements;
}
function makeElement(scene, node, screen, ctx, override, box, order) {
  const get = (k) => field(node.fields, k, screen);
  const atom = { ...cascade(ctx.css, [`[data-node="${node.id}"] .scene-atom`, `#scene-${scene.id} [data-node="${node.id}"] .scene-atom`], ctx.width), ...parseDecls(node.atomStyle || '') };
  const hUnits = get('heightunits'), wUnits = get('widthunits'), container = get('container');
  const rawTop = Number(get('top')), rawHeight = Number(get('height')), rawLeft = Number(get('left')), rawWidth = Number(get('width'));
  const top = rawTop + override.translateY;
  const height = hUnits === '%' ? ctx.height * rawHeight / 100 : rawHeight;
  const base = container === 'window' ? ctx.boardWidth : screen;
  const width = wUnits === '%' ? base * rawWidth / 100 : rawWidth;
  let x0 = container === 'window' ? rawLeft : (ctx.boardWidth - screen) / 2 + rawLeft;
  if (get('axisx') === 'center' && container === 'window') x0 += (ctx.boardWidth - width) / 2;
  const opacity = Number(box.opacity ?? atom.opacity ?? 1);
  const color = parseColor(atom['background-color']);
  const image = !!node.background || hasImage(atom['background-image']);
  const radius = /[1-9]/.test(String(atom['border-radius'] || '').replace(/var\([^)]*\)/g, ''));
  return {
    id: node.id, type: node.type, order, z: Number(box['z-index'] ?? 0) || 0,
    top, bottom: top + height, known: [top, height].every(Number.isFinite),
    fullWidth: Number.isFinite(x0 + width) && x0 <= EPS && x0 + width >= ctx.boardWidth - EPS,
    color: color ? [color[0], color[1], color[2], color[3] * opacity] : null,
    image, radius,
  };
}
function analyzeBlock(scene, range, data) {
  const { sample: width } = range;
  const screens = (scene.board.screens || '320,480,640,960,1200').split(',').map(Number);
  const screen = screenFor(width, screens);
  const scale = field(scene.board, 'upscale', screen, true) === 'window' ? Number((width / screen).toFixed(3)) : 1;
  const height = Number(field(scene.board, 'height', screen, true) || 0);
  const css = cascadeBlock(scene, width, data);
  const ctx = { css: data.css, overrides: data.overrides, width, height, boardWidth: width / scale };
  const elements = collectElements(scene, screen, ctx);
  const info = {
    id: scene.id, screen, scale, height, padTop: parseFloat(css.section['padding-top']) || 0, padBottom: parseFloat(css.section['padding-bottom']) || 0,
    ovrflw: field(scene.board, 'ovrflw', screen, true), pos: scene.board.pos, vh: Number(field(scene.board, 'height_vh', screen, true) || 0),
    unknown: elements.filter((e) => !e.known).map((e) => e.id),
  };
  // Фигура или картинка на всю ширину и всю высоту, либо у края: фон этого края, а не содержимое. Линия в 1–2 px остаётся содержимым.
  const isBackdrop = (e) => ['shape', 'image', 'video'].includes(e.type) && e.fullWidth && !e.radius && e.known && e.bottom - e.top > 2;
  const full = (e) => isBackdrop(e) && e.top <= EPS && e.bottom >= height - EPS;
  const touchesTop = (e) => isBackdrop(e) && e.top <= EPS && e.bottom > 0;
  const touchesBottom = (e) => isBackdrop(e) && e.bottom >= height - EPS && e.top < height;
  const paintOrder = (a, b) => (a.z - b.z) || (a.order - b.order);
  const top = [...elements.filter(touchesTop)].sort(paintOrder).pop();
  const bottom = [...elements.filter(touchesBottom)].sort(paintOrder).pop();
  const artboard = artboardFill(css, data.pageColor);
  const fill = (e, padded) => {
    if (e && (e.type !== 'shape' || e.image)) return { kind: 'image', source: e.type === 'shape' ? 'картинка в фигуре' : e.type === 'video' ? 'видео' : 'картинка' };
    if (e && e.color) return artboard.image ? { kind: 'image', source: 'картинка артборда' } : { kind: 'color', color: over(e.color, artboard.color), source: full(e) ? 'фигура на весь блок' : 'фигура у края' };
    if (padded && css.section['background-color']) return { kind: 'color', color: over(parseColor(css.section['background-color']), data.pageColor), source: 'запись' };
    if (artboard.image) return { kind: 'image', source: 'картинка артборда' };
    return { kind: 'color', color: artboard.color, source: artboard.source };
  };
  info.topFill = fill(top, info.padTop > 0);
  info.bottomFill = fill(bottom, info.padBottom > 0);
  const contentTop = elements.filter((e) => e.known && !full(e) && e !== top);
  const contentBottom = elements.filter((e) => e.known && !full(e) && e !== bottom);
  info.empty = !contentTop.length && !contentBottom.length;
  const minTop = contentTop.length ? Math.min(...contentTop.map((e) => e.top)) : height;
  const maxBottom = contentBottom.length ? Math.max(...contentBottom.map((e) => e.bottom)) : 0;
  // Зазор считаем только в пределах полосы одного цвета: дальше фон уже другой
  info.gapTop = Math.min(minTop, top && !full(top) ? top.bottom : minTop);
  info.gapBottom = height - Math.max(maxBottom, bottom && !full(bottom) ? bottom.top : maxBottom);
  // Отступы записи в пикселях окна, не масштабируются
  info.realTop = info.padTop + info.gapTop * scale;
  info.realBottom = info.padBottom + info.gapBottom * scale;
  return info;
}
function cascadeBlock(scene, width, data) {
  const id = `#scene-${scene.id}`;
  return {
    section: cascade(data.css, [id], width),
    canvas: cascade(data.css, [`${id} .scene-canvas`], width),
    background: cascade(data.css, [`${id} .scene-background`], width),
    filter: cascade(data.css, [`${id} .scene-filter`], width),
  };
}
function artboardFill(css, pageColor) {
  if (hasImage(css.background['background-image']) || hasImage(css.filter['background-image'])) return { image: true, color: pageColor, source: 'картинка артборда' };
  const canvas = parseColor(css.canvas['background-color']);
  if (canvas && canvas[3] > 0) return { color: over(canvas, pageColor), source: 'артборд' };
  const section = parseColor(css.section['background-color']);
  if (section && section[3] > 0) return { color: over(section, pageColor), source: 'запись' };
  return { color: pageColor, source: 'цвет страницы' };
}

// ---------- Порядок блоков как в App.vue ----------
function pageSequence(page, sceneOf) {
  const popups = new Set((page.popups || []).flatMap((p) => (p.scenes || []).map(String)));
  const items = [];
  for (const block of page.blocks || []) {
    if (block.kind === 'anchor') continue;
    if (block.kind === 'embed') {
      const entry = registry[block.rec];
      // Служебные встраивания ничего не занимают на странице; видимая разметка только у записей с reserve
      if (entry?.kind === 'component' && entry.reserve) items.push({ kind: 'barrier', label: `встраивание ${block.rec}` });
      continue;
    }
    if (block.kind === 'scene') {
      if (popups.has(block.id)) continue;
      const scene = sceneOf(block.id);
      if (scene) items.push({ kind: 'scene', scene });
      continue;
    }
    items.push({ kind: 'barrier', label: `${block.kind === 'spacer' ? 'разделитель' : block.kind} ${block.id}` });
  }
  if (page.shell?.footer && sceneOf(page.shell.footer)) items.push({ kind: 'scene', scene: sceneOf(page.shell.footer), footer: true });
  return items;
}
function visibleAt(scene, width) {
  const min = Number.parseFloat(scene.min), max = Number.parseFloat(scene.max);
  return (!Number.isFinite(min) || width > min) && (!Number.isFinite(max) || width <= max);
}
function frozenReason(info) {
  if (FROZEN.has(info.id)) return FROZEN.get(info.id);
  // Ленты участвуют в правиле отступов: прокрутка у них по горизонтали, вертикальный отступ считается как у обычного блока (Елена, 10.11)
  if (info.ovrflw === 'visible') return 'элементы выходят за блок (ovrflw visible)';
  if (info.pos === 'fixed' || info.pos === 'sticky') return `блок ${info.pos}`;
  if (info.vh) return 'высота блока зависит от окна (height_vh)';
  return null;
}

// ---------- Решение по паре ----------
function decide(a, b, footer) {
  const row = { color: '', gapA: round(a.realBottom), gapB: round(b.realTop), action: 'skip', margin: null, reason: '', note: '' };
  row.fillA = a.bottomFill.kind === 'color' ? hexOf(a.bottomFill.color) : a.bottomFill.source;
  row.fillB = b.topFill.kind === 'color' ? hexOf(b.topFill.color) : b.topFill.source;
  row.color = row.fillA === row.fillB ? row.fillA : `${row.fillA} / ${row.fillB}`;
  const frozen = frozenReason(a) || frozenReason(b);
  if (frozen) { row.reason = frozen; return row; }
  if (a.bottomFill.kind === 'image' || b.topFill.kind === 'image') { row.reason = 'фон картинка или видео'; return row; }
  if (a.unknown.length || b.unknown.length) { row.reason = `нет геометрии: ${[...a.unknown, ...b.unknown].join(',')}`; return row; }
  if (row.fillA !== row.fillB) {
    const distance = a.bottomFill.color.slice(0, 3).reduce((sum, v, i) => sum + Math.abs(v - b.topFill.color[i]), 0);
    if (distance <= 8) row.note = 'почти равны';
    if (!(nearColors && distance <= 8)) { row.reason = footer ? 'подвал другого цвета' : 'цвета разные'; return row; }
  }
  if (a.scale !== b.scale) { row.reason = 'разный масштаб блоков'; return row; }
  // При масштабе высота блока округляется вниз (Math.floor в SceneBlock), реальный низ A меньше на долю пикселя: берём запас в 1 px
  const correction = a.scale !== 1 ? 1 : 0;
  const safeA = round(row.gapA - correction);
  if (safeA <= 0 || row.gapB <= 0) { row.reason = 'отступ не больше 0'; return row; }
  // Меньший отступ раскладываем на часть записи (без масштаба) и часть артборда (с масштабом)
  const fromA = safeA <= row.gapB;
  const px = round(fromA ? a.gapBottom : b.gapTop);
  const pad = fromA ? a.padBottom : b.padTop;
  row.action = 'change'; row.margin = { px, pad, correction: fromA ? correction : 0, real: round(Math.min(safeA, row.gapB)) };
  row.result = round(Math.max(row.gapA, row.gapB));
  if (a.empty || b.empty) row.note = [row.note, 'пустой блок'].filter(Boolean).join(', ');
  return row;
}
function marginValue({ px, pad, correction }) {
  const scaled = `${px}px * var(--scene-scale, 1)`;
  return `calc(-1 * ${pad ? `(${pad}px + ${scaled})` : scaled}${correction ? ' + 1px' : ''})`;
}

// ---------- Главный проход ----------
const routes = readJson(`${CONTENT}/routes.json`);
const shared = readJson(`${CONTENT}/shared-layout.json`);
const overrides = nodeOverrides(parseCss(read('src/style.css')));
const rows = [], rulesBySelector = new Map(), conflicts = [], barriers = [];
for (const route of routes) {
  const page = readJson(`${CONTENT}/${route.page}.json`);
  const sceneOf = (id) => page.scenes.find((s) => s.id === String(id)) || shared.scenes.find((s) => s.id === String(id));
  const css = indexRules(parseCss(read(`${CONTENT}/shared-layout.css`) + '\n' + read(`${CONTENT}/${route.page}.css`)));
  const pageColor = over(parseColor(page.shell?.background || '#ffffff'), [255, 255, 255, 1]);
  const data = { css, overrides, pageColor };
  const sequence = pageSequence(page, sceneOf);
  for (const range of RANGES) {
    let previous = null, broken = null;
    for (const item of sequence) {
      if (item.kind === 'barrier') { broken = item.label; continue; }
      if (!visibleAt(item.scene, range.sample)) continue;
      if (previous && broken) barriers.push({ page: route.path, a: previous.scene.id, b: item.scene.id, screen: range.screen, label: broken });
      if (previous && !broken) {
        const a = analyzeBlock(previous.scene, range, data), b = analyzeBlock(item.scene, range, data);
        const row = decide(a, b, !!item.footer);
        rows.push({ page: route.path, a: a.id, b: b.id, screen: range.screen, footer: !!item.footer, sourceA: a.bottomFill.source, sourceB: b.topFill.source, ...row });
        if (row.action === 'change') {
          const key = `${range.screen}|${b.id}`, value = marginValue(row.margin);
          if (rulesBySelector.has(key) && rulesBySelector.get(key).value !== value) conflicts.push(key);
          rulesBySelector.set(key, { screen: range.screen, media: range.media, id: b.id, value, page: route.path, a: a.id });
        }
      }
      previous = item; broken = null;
    }
  }
}
if (conflicts.length) {
  console.error(`Один блок на разных страницах требует разного сдвига: ${[...new Set(conflicts)].join(', ')}`);
  process.exit(1);
}

// ---------- Запись и отчёт ----------
const rules = [...rulesBySelector.values()].sort((x, y) => RANGES.findIndex((r) => r.screen === x.screen) - RANGES.findIndex((r) => r.screen === y.screen));
const body = RANGES.map((range) => {
  const part = rules.filter((r) => r.screen === range.screen);
  return part.length ? `@media screen and ${range.media}{\n${part.map((r) => `#scene-${r.id}{margin-top:${r.value}} /* ${r.page} после ${r.a} */`).join('\n')}\n}` : '';
}).filter(Boolean).join('\n');
const output = `/* Создано tools/block-spacing.mjs, вручную не менять. Соседние Zero-блоки одного цвета: один отступ вместо двух (правило заказчика 10.11.2026) */\n${body}\n`;
if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify({ rows, barriers }, null, 1));
if (checkOnly) {
  const current = fs.existsSync(OUTPUT) ? read(OUTPUT) : '';
  if (current !== output) { console.error(`${OUTPUT} устарел: запустите node tools/block-spacing.mjs`); process.exit(1); }
  console.log(`${OUTPUT} актуален: правил ${rules.length}`);
  process.exit(0);
}
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, output);

if (!quiet) {
  const header = ['страница', 'блок A', 'блок B', 'цвет', 'экран', 'низ A', 'верх B', 'итог', 'что сделано'];
  const lines = rows.map((r) => [r.page, r.a, r.b + (r.footer ? ' (подвал)' : ''), r.color, r.screen, r.gapA, r.gapB, r.action === 'change' ? r.result : round(r.gapA + r.gapB),
    (r.action === 'change' ? `margin-top −${r.margin.real}` : `без изменений: ${r.reason}`) + (r.note ? ` [${r.note}]` : '')].map(String));
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const print = (l) => console.log(l.map((v, i) => v.padEnd(widths[i])).join(' | '));
  print(header);
  console.log(widths.map((w) => '-'.repeat(w)).join('-+-'));
  lines.forEach(print);
  if (barriers.length) {
    console.log('\nПары, разделённые не Zero-блоком (не меняются):');
    for (const b of barriers) console.log(`${b.page} | ${b.a} → ${b.b} | экран ${b.screen} | ${b.label}`);
  }
}
const changed = rows.filter((r) => r.action === 'change');
console.log(`\nПравил в ${OUTPUT}: ${rules.length}`);
for (const route of routes) {
  const of = (screen) => changed.filter((r) => r.page === route.path && r.screen === screen).length;
  if (rows.some((r) => r.page === route.path)) console.log(`${route.path}: ${RANGES.map((r) => `${r.screen}=${of(r.screen)}`).join(' ')}`);
}
